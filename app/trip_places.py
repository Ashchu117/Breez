"""Look up mapped Florida destinations by OpenStreetMap category."""

import json
import re
from functools import lru_cache
from threading import BoundedSemaphore
from time import monotonic
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Response

from app.florida import inside_ring, is_in_florida
from app.mission_contracts import Contract, Coordinates, Place, TripCategory

router = APIRouter(prefix="/api")
URL = "https://photon.komoot.io/api/"
CENSUS_PLACES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer"
TAGS = {"supermarket": "shop", "pharmacy": "amenity", "restaurant": "amenity",
        "cafe": "amenity", "park": "leisure", "hospital": "amenity"}
LIMIT_BYTES = 512 * 1024
slots = BoundedSemaphore(2)


class TripPlacesRequest(Contract):
    category: TripCategory
    city: str | None
    region: Coordinates


def read_json(url, timeout=6):
    request = Request(url, headers={
        "User-Agent": "Breez/1.0 (https://breez.skysoft.us/)",
        "Accept": "application/json",
    })
    with urlopen(request, timeout=timeout) as upstream:
        raw = upstream.read(LIMIT_BYTES + 1)
    if len(raw) > LIMIT_BYTES:
        raise ValueError("Map response too large")
    return json.loads(raw)


@lru_cache(maxsize=96)
def city_polygons(city, cache_window):
    params = urlencode({
        "f": "geojson", "outFields": "BASENAME", "outSR": "4326",
        "where": "STATE='12' AND UPPER(BASENAME)='" + city.upper().replace("'", "''") + "'",
        "maxAllowableOffset": "0.0002",
    })
    for layer in (4, 5):
        result = read_json(f"{CENSUS_PLACES}/{layer}/query?{params}")
        if "error" in result:
            raise ValueError("Census place search unavailable")
        for feature in result["features"]:
            geometry = feature.get("geometry") or {}
            if geometry.get("type") == "Polygon":
                return [geometry["coordinates"]]
            if geometry.get("type") == "MultiPolygon":
                return geometry["coordinates"]
    return []


@lru_cache(maxsize=96)
def mapped_places(category, city, lat, lon, cache_window):
    tag = TAGS[category]
    polygons = city_polygons(city, cache_window) if city else []
    if city and not polygons:
        return []
    if polygons:
        lons, lats = zip(*(point for polygon in polygons for point in polygon[0]))
        bounds = (min(lons), min(lats), max(lons), max(lats))
        lat, lon = (bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2
    else:
        bounds = (lon - 0.4, lat - 0.4, lon + 0.4, lat + 0.4)
    params = urlencode({
        "include": f"osm.{tag}.{category}", "bbox": ",".join(map(str, bounds)),
        "lat": lat, "lon": lon, "zoom": 12, "limit": 50, "dedupe": 0,
    })
    payload = read_json(URL + "?" + params, timeout=8)
    places = []
    for feature in payload["features"]:
        tags = feature["properties"]
        name = tags.get("name")
        if (tags.get("osm_key") != tag or tags.get("osm_value") != category
                or not name or len(name) > 240 or feature["geometry"]["type"] != "Point"):
            continue
        longitude, latitude = feature["geometry"]["coordinates"]
        street = " ".join(filter(None, (tags.get("housenumber"), tags.get("street"))))
        address = ", ".join(filter(None, (street, tags.get("city") or city, "Florida")))
        place = Place(name=name, address=address[:300], lat=latitude, lon=longitude)
        if not is_in_florida(place):
            continue
        if polygons and not any(inside_ring(place, outer) and not any(inside_ring(place, hole) for hole in holes)
                                for outer, *holes in polygons):
            continue
        places.append(place)
    return places


@router.post("/trip-places")
def trip_places(payload: TripPlacesRequest, response: Response) -> list[Place]:
    response.headers["Cache-Control"] = "no-store"
    city = payload.city
    if city and (len(city) > 80 or not re.fullmatch(r"[\w .'-]+", city)):
        raise HTTPException(422, "Use a Florida city name.")
    lat = round(payload.region.lat * 2) / 2
    lon = round(payload.region.lon * 2) / 2
    if not (24 <= lat <= 31.5 and -88 <= lon <= -79.5):
        raise HTTPException(422, "Choose a starting point in Florida.")
    if not slots.acquire(blocking=False):
        raise HTTPException(503, "Place search is busy. Try again.")
    try:
        return mapped_places(payload.category, city, None if city else lat, None if city else lon, int(monotonic() // 300))
    except (OSError, ValueError, TypeError, AttributeError, KeyError):
        raise HTTPException(503, "Category search is temporarily unavailable.") from None
    finally:
        slots.release()
