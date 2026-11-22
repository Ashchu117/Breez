"""Screen a route preview against the FAA airspace snapshot."""

from itertools import pairwise
from math import asin, cos, radians, sin, sqrt

from fastapi import APIRouter, HTTPException, Response

from app.faa_airspace import airspace_in_extent, intersects_area, nearby_airspace
from app.florida import is_in_florida
from app.mission_contracts import (
    ConfirmedRoute,
    Coordinates,
    RouteFinding,
    RouteRequest,
    RouteResponse,
    TripRouteRequest,
)
from app.route_grid import find_detour, route_grid_bounds


router = APIRouter(prefix="/api")
EARTH_RADIUS_MILES = 3958.76
DEMO_SPEED_MPH = 40.0


def distance_miles(start: Coordinates, end: Coordinates) -> float:
    delta_lat = radians(end.lat - start.lat)
    delta_lon = radians(end.lon - start.lon)
    haversine = sin(delta_lat / 2) ** 2 + cos(radians(start.lat)) * cos(radians(end.lat)) * sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * asin(min(1, sqrt(haversine)))


def route_endpoints(mission: ConfirmedRoute) -> tuple[Coordinates, Coordinates]:
    start = Coordinates(lat=mission.origin.lat, lon=mission.origin.lon)
    end = Coordinates(lat=mission.destination.lat, lon=mission.destination.lon)
    if start == end:
        raise ValueError("Choose different start and end locations.")
    if not is_in_florida(start) or not is_in_florida(end):
        raise ValueError("Choose start and end locations in Florida.")

    return start, end


def screen_route(points: list[Coordinates]) -> RouteResponse:
    retrieved_at, areas = nearby_airspace(points)
    segments = list(pairwise(points))
    distance = sum(distance_miles(start, end) for start, end in segments)
    findings = [
        RouteFinding(code="FAA_AIRSPACE_OVERLAP", zone_id=zone.id, segment_index=index)
        for index, (start, end) in enumerate(segments)
        for zone in areas
        if intersects_area(start, end, zone)
    ]
    return RouteResponse(
        simulation=True,
        status="blocked" if findings else "no_listed_overlap",
        points=points,
        distance_miles=distance,
        eta_minutes=None if findings else distance / DEMO_SPEED_MPH * 60,
        assumed_speed_mph=DEMO_SPEED_MPH,
        findings=findings,
        restrictions=areas,
        airspace_retrieved_at=retrieved_at,
    )


def simulate_route(mission: ConfirmedRoute) -> RouteResponse:
    return screen_route(list(route_endpoints(mission)))


def alternative_route(mission: ConfirmedRoute, *, direct: RouteResponse | None = None) -> RouteResponse | None:
    direct = direct if direct is not None else simulate_route(mission)
    start, end = direct.points
    if not direct.findings:
        return direct

    extent = route_grid_bounds(start, end)
    _, areas = airspace_in_extent(extent)

    def can_connect(origin, destination):
        _, nearby = nearby_airspace([origin, destination], margin=0)
        return not any(intersects_area(origin, destination, area) for area in nearby)

    if not can_connect(start, start) or not can_connect(end, end):
        return None
    points = find_detour(start, end, extent, areas, distance_miles, can_connect)
    if points is None:
        return None
    result = screen_route(points)
    return None if result.findings else result


@router.post("/route-simulation")
def route_simulation(mission: RouteRequest | TripRouteRequest, response: Response) -> RouteResponse:
    """Screen the confirmed route against published FAA areas."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return simulate_route(mission)
    except OSError:
        raise HTTPException(status_code=503, detail="FAA airspace data is unavailable.") from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None


@router.post("/route-alternative")
def route_alternative(mission: RouteRequest | TripRouteRequest, response: Response) -> RouteResponse | None:
    """Find an alternate simulation candidate using the same FAA snapshot."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return alternative_route(mission)
    except OSError:
        raise HTTPException(status_code=503, detail="FAA airspace data is unavailable.") from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
