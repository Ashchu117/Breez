"""Simulate a direct route candidate, with optional fictional restrictions."""

from math import asin, cos, hypot, radians, sin, sqrt

from fastapi import APIRouter, HTTPException, Response

from app.florida import is_in_florida
from app.mission_contracts import (
    ConfirmedRoute,
    Coordinates,
    RouteFinding,
    RouteRequest,
    RouteResponse,
    SimulatedRestriction,
    TripRouteRequest,
)


router = APIRouter(prefix="/api")
EARTH_RADIUS_MILES = 3958.76
DEMO_SPEED_MPH = 40.0


def distance_miles(start: Coordinates, end: Coordinates) -> float:
    delta_lat = radians(end.lat - start.lat)
    delta_lon = radians(end.lon - start.lon)
    haversine = sin(delta_lat / 2) ** 2 + cos(radians(start.lat)) * cos(radians(end.lat)) * sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * asin(min(1, sqrt(haversine)))


def intersects_restriction(
    start: Coordinates, end: Coordinates, zone: SimulatedRestriction
) -> bool:
    # Use a local plane in miles centered on the fictional zone.
    lon_scale = EARTH_RADIUS_MILES * cos(radians(zone.center.lat))
    start_x = lon_scale * radians(start.lon - zone.center.lon)
    start_y = EARTH_RADIUS_MILES * radians(start.lat - zone.center.lat)
    dx = lon_scale * radians(end.lon - start.lon)
    dy = EARTH_RADIUS_MILES * radians(end.lat - start.lat)
    segment_squared = dx * dx + dy * dy
    if not segment_squared:
        return hypot(start_x, start_y) <= zone.radius_miles

    fraction = -(start_x * dx + start_y * dy) / segment_squared
    nearest = min(1.0, max(0.0, fraction))
    return hypot(start_x + nearest * dx, start_y + nearest * dy) <= zone.radius_miles


def simulate_route(
    mission: ConfirmedRoute, restrictions: tuple[SimulatedRestriction, ...] = ()
) -> RouteResponse:
    start = Coordinates(lat=mission.origin.lat, lon=mission.origin.lon)
    end = Coordinates(lat=mission.destination.lat, lon=mission.destination.lon)
    distance = distance_miles(start, end)
    if distance == 0:
        raise ValueError("Choose different start and end locations.")
    if not is_in_florida(start) or not is_in_florida(end):
        raise ValueError("Choose start and end locations in Florida.")

    findings = [
        RouteFinding(code="SIMULATED_RESTRICTION", zone_id=zone.id, segment_index=0)
        for zone in restrictions
        if intersects_restriction(start, end, zone)
    ]
    return RouteResponse(
        simulation=True,
        status="blocked" if findings else "passes_demo_checks",
        points=[start, end],
        distance_miles=distance,
        eta_minutes=None if findings else distance / DEMO_SPEED_MPH * 60,
        assumed_speed_mph=DEMO_SPEED_MPH,
        findings=findings,
        restrictions=list(restrictions),
    )


@router.post("/route-simulation")
def route_simulation(mission: RouteRequest | TripRouteRequest, response: Response) -> RouteResponse:
    """Evaluate a confirmed mission in the Breez simulation."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return simulate_route(mission)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
