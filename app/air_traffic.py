import json
import logging
from math import isfinite
from threading import Lock
from time import monotonic, time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

# Florida Poly / Lakeland, within 35 nautical miles.
FEED_URL = "https://api.adsb.lol/v2/point/28.15/-81.85/35"
REFRESH_SECONDS = 240
MAX_POSITION_AGE_SECONDS = 90
MAX_FEED_BYTES = 512 * 1024
cache_lock = Lock()
snapshot = None
next_refresh = 0.0


def valid_number(value) -> bool:
    return type(value) in (float, int) and isfinite(value)


def read_snapshot() -> dict:
    request = Request(FEED_URL, headers={"User-Agent": "Breez/1.0", "Accept": "application/json"})
    with urlopen(request, timeout=5) as response:
        content = response.read(MAX_FEED_BYTES + 1)
    if len(content) > MAX_FEED_BYTES:
        raise ValueError("Aircraft feed exceeded the response size limit")

    payload = json.loads(content)
    observed_at = payload.get("now")
    records = payload.get("ac")
    if not valid_number(observed_at) or abs(time() - observed_at / 1000) > 120:
        raise ValueError("Aircraft feed timestamp is outside the freshness window")
    if not isinstance(records, list):
        raise ValueError("Aircraft feed is missing its aircraft list")

    aircraft = []
    for record in records:
        lat, lon, age = (record.get(key) for key in ("lat", "lon", "seen_pos"))
        if not all(valid_number(value) for value in (lat, lon, age)):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= age <= MAX_POSITION_AGE_SECONDS):
            continue

        heading = record.get("track")
        aircraft.append({
            "latitude": lat,
            "longitude": lon,
            "heading": heading % 360 if valid_number(heading) else None,
        })

    return {"observed_at": observed_at, "aircraft": aircraft, "source": FEED_URL}


@router.get("/air-traffic")
def air_traffic() -> dict:
    global snapshot, next_refresh

    # A single upstream request per interval for all viewers of this worker.
    with cache_lock:
        if monotonic() >= next_refresh:
            next_refresh = monotonic() + REFRESH_SECONDS
            try:
                snapshot = read_snapshot()
            except (OSError, ValueError, AttributeError) as error:
                snapshot = None
                if isinstance(error, HTTPError):
                    retry_after = error.headers.get("Retry-After", "")
                    if retry_after.isdecimal():
                        next_refresh = max(next_refresh, monotonic() + int(retry_after))
                logger.warning("Aircraft feed unavailable: %s", error)

        if snapshot is None:
            raise HTTPException(status_code=503, detail="Aircraft data is temporarily unavailable")
        return snapshot
