"""Published FAA areas used for horizontal overlap screening."""

import gzip
import json
from functools import cache
from pathlib import Path

from app.florida import inside_ring
from app.mission_contracts import AirspaceRestriction, Coordinates


SNAPSHOT = Path(__file__).parent / "data" / "faa-airspace.json.gz"


def bounds(points):
    lons, lats = zip(*points)
    return min(lons), min(lats), max(lons), max(lats)


def overlaps(first, second):
    return (
        first[0] <= second[2] and first[2] >= second[0]
        and first[1] <= second[3] and first[3] >= second[1]
    )


@cache
def load_airspace():
    with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as source:
        content = json.load(source)
    areas = []
    for item in content["areas"]:
        area = AirspaceRestriction.model_validate(item)
        extent = bounds(point for polygon in area.polygons for point in polygon[0])
        areas.append((extent, area))
    return content["retrieved_at"], areas


def segments_intersect(a, b, c, d):
    if not overlaps(bounds((a, b)), bounds((c, d))):
        return False

    def side(p, q, r):
        area = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 1 if area > 1e-12 else -1 if area < -1e-12 else 0

    return side(a, b, c) * side(a, b, d) <= 0 and side(c, d, a) * side(c, d, b) <= 0


def intersects_area(start: Coordinates, end: Coordinates, area: AirspaceRestriction) -> bool:
    a = (start.lon, start.lat)
    b = (end.lon, end.lat)
    for outer, *holes in area.polygons:
        for point in (start, end):
            if inside_ring(point, outer) and not any(inside_ring(point, hole) for hole in holes):
                return True
        for ring in (outer, *holes):
            if any(segments_intersect(a, b, c, d) for c, d in zip(ring, ring[1:])):
                return True
    return False


def nearby_airspace(start: Coordinates, end: Coordinates):
    retrieved_at, areas = load_airspace()
    west, south, east, north = bounds(((start.lon, start.lat), (end.lon, end.lat)))
    margin = 0.05
    viewport = (west - margin, south - margin, east + margin, north + margin)
    return retrieved_at, [area for extent, area in areas if overlaps(viewport, extent)]
