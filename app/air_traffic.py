import json
import logging
from dataclasses import dataclass, field
from math import isfinite
from threading import BoundedSemaphore, Lock
from time import monotonic, time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query, Response

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

FEED_POINT_URL = "https://api.adsb.lol/v2/point"
RADIUS_NM = 50
REFRESH_SECONDS = 240
RETRY_SECONDS = 30
MAX_SNAPSHOT_AGE_SECONDS = 15 * 60
MAX_POSITION_AGE_SECONDS = 90
MAX_FEED_BYTES = 512 * 1024
# Leave headroom under the unauthenticated 500 requests per IP per UTC day.
REQUESTS_PER_DAY = 450
cache_lock = Lock()
upstream_slots = BoundedSemaphore(4)
budget_day = -1
requests_used = 0
blocked_until = 0.0


@dataclass
class CachedRegion:
    lock: Lock = field(default_factory=Lock)
    snapshot: dict | None = None
    refresh_at: float = 0.0
    delayed: bool = False


regions: dict[tuple[float, float], CachedRegion] = {}


def valid_number(value) -> bool:
    return type(value) in (float, int) and isfinite(value)


def read_snapshot(lat: float, lon: float) -> dict:
    url = f"{FEED_POINT_URL}/{lat}/{lon}/{RADIUS_NM}"
    request = Request(url, headers={"User-Agent": "Breez/1.0", "Accept": "application/json"})
    with urlopen(request, timeout=5) as response:
        content = response.read(MAX_FEED_BYTES + 1)
    if len(content) > MAX_FEED_BYTES:
        raise ValueError("Aircraft feed exceeded the response size limit")

    payload = json.loads(content)
    observed_at = payload.get("now")
    records = payload.get("ac")
    if not valid_number(observed_at) or abs(time() - observed_at / 1000) > 120:
        raise ValueError("Aircraft feed timestamp is outside the freshness window")
    if records is None and payload.get("total") == 0:
        records = []
    if not isinstance(records, list):
        raise ValueError("Aircraft feed is missing its aircraft list")

    aircraft = []
    for record in records:
        if not isinstance(record, dict):
            continue
        latitude, longitude, age = (record.get(key) for key in ("lat", "lon", "seen_pos"))
        if not all(valid_number(value) for value in (latitude, longitude, age)):
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180 and 0 <= age <= MAX_POSITION_AGE_SECONDS):
            continue

        heading = record.get("track")
        aircraft.append({
            "latitude": latitude,
            "longitude": longitude,
            "heading": heading % 360 if valid_number(heading) else None,
        })

    return {
        "observed_at": observed_at,
        "aircraft": aircraft,
        "source": url,
        "region": {"lat": lat, "lon": lon},
    }


def reserve_request() -> bool:
    global budget_day, requests_used

    with cache_lock:
        today = int(time() // 86_400)
        if today != budget_day:
            budget_day = today
            requests_used = 0
        if requests_used >= REQUESTS_PER_DAY or monotonic() < blocked_until:
            return False
        requests_used += 1
        return True


def refresh_region(cached: CachedRegion, lat: float, lon: float) -> None:
    global blocked_until

    cached.delayed = True
    cached.refresh_at = monotonic() + RETRY_SECONDS
    if not upstream_slots.acquire(blocking=False):
        return
    try:
        if not reserve_request():
            return
        cached.snapshot = read_snapshot(lat, lon)
        cached.delayed = False
        cached.refresh_at = monotonic() + REFRESH_SECONDS
    except (OSError, ValueError, AttributeError) as error:
        if isinstance(error, HTTPError) and error.code == 429:
            retry_after = error.headers.get("Retry-After", "")
            backoff = int(retry_after) if retry_after.isdecimal() else 900
            with cache_lock:
                blocked_until = max(blocked_until, monotonic() + backoff)
        logger.warning("Aircraft feed unavailable: %s", error)
    finally:
        upstream_slots.release()


@router.get("/air-traffic")
def air_traffic(
    response: Response,
    lat: float = Query(28.15, ge=24, le=31.5),
    lon: float = Query(-81.85, ge=-88, le=-79.5),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    # Coarse buckets bound cache size and keep exact coordinates off the feed URL.
    center = (round(lat * 2) / 2, round(lon * 2) / 2)
    with cache_lock:
        cached = regions.get(center)
        if cached is None:
            cached = regions[center] = CachedRegion()

    with cached.lock:
        if monotonic() >= cached.refresh_at:
            refresh_region(cached, *center)
        if cached.snapshot is None or time() - cached.snapshot["observed_at"] / 1000 > MAX_SNAPSHOT_AGE_SECONDS:
            raise HTTPException(
                status_code=503, detail="Aircraft data is temporarily unavailable",
                headers={"Cache-Control": "no-store"},
            )
        return {**cached.snapshot, "delayed": cached.delayed}
