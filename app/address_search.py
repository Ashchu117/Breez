import json
import re
from threading import BoundedSemaphore
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api")
CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
MAX_RESPONSE_BYTES = 256 * 1024
NUMBERED_ADDRESS = re.compile(r"^(\d+[a-z]?(?:-\d+)?)\s+\S", re.IGNORECASE)
FLORIDA_QUALIFIER = re.compile(r"\b(?:FL|Florida|(?:32|33|34)\d{3})\b", re.IGNORECASE)
lookup_slots = BoundedSemaphore(4)


class AddressQuery(BaseModel):
    query: str = Field(min_length=5, max_length=150)


def census_matches(query: str, number: str) -> list[dict]:
    address = query if FLORIDA_QUALIFIER.search(query) else f"{query}, FL"
    params = urlencode({"address": address, "benchmark": "Public_AR_Current", "format": "json"})
    request = Request(f"{CENSUS_URL}?{params}", headers={"User-Agent": "Breez/1.0"})
    with urlopen(request, timeout=5) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("Census response exceeded size limit")

    results = []
    matches = json.loads(raw)["result"]["addressMatches"]
    for match in matches[:10]:
        components = match["addressComponents"]
        if components.get("state") != "FL":
            continue
        street, _, _ = match["matchedAddress"].partition(",")
        house = NUMBERED_ADDRESS.match(street)
        if not house or house.group(1).casefold() != number.casefold():
            continue
        city = components.get("city", "").title()
        zip_code = components.get("zip", "")
        coords = match["coordinates"]
        results.append({
            "name": street.title(),
            "address": ", ".join(filter(None, [city, f"FL {zip_code}".strip()])),
            "area": city,
            "houseNumber": house.group(1),
            "street": street[house.end(1):].strip(),
            "kind": "estimate",
            "lat": coords["y"],
            "lon": coords["x"],
        })
    return results


@router.post("/address-search")
def search_address(payload: AddressQuery, response: Response) -> dict:
    # Keep typed addresses out of access-log URLs and shared HTTP caches.
    response.headers["Cache-Control"] = "no-store"
    query = " ".join(payload.query.split())
    house = NUMBERED_ADDRESS.match(query)
    if not house:
        return {"places": []}
    if not lookup_slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Address lookup is busy")
    try:
        return {"places": census_matches(query, house.group(1))}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(status_code=503, detail="Address lookup is temporarily unavailable") from None
    finally:
        lookup_slots.release()
