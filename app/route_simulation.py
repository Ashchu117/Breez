"""Screen a route preview against the FAA airspace snapshot."""

from math import asin, cos, radians, sin, sqrt

from fastapi import APIRouter, HTTPException, Response

from app.faa_airspace import intersects_area, nearby_airspace
from app.florida import is_in_florida
from app.mission_contracts import (
    ConfirmedRoute,
    Coordinates,
    RouteFinding,
    RouteRequest,
    RouteResponse,
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


def simulate_route(mission: ConfirmedRoute) -> RouteResponse:
    start = Coordinates(lat=mission.origin.lat, lon=mission.origin.lon)
    end = Coordinates(lat=mission.destination.lat, lon=mission.destination.lon)
    distance = distance_miles(start, end)
    if distance == 0:
        raise ValueError("Choose different start and end locations.")
    if not is_in_florida(start) or not is_in_florida(end):
        raise ValueError("Choose start and end locations in Florida.")

    retrieved_at, areas = nearby_airspace(start, end)
    findings = [
        RouteFinding(code="FAA_AIRSPACE_OVERLAP", zone_id=zone.id, segment_index=0)
        for zone in areas
        if intersects_area(start, end, zone)
    ]
    return RouteResponse(
        simulation=True,
        status="blocked" if findings else "no_listed_overlap",
        points=[start, end],
        distance_miles=distance,
        eta_minutes=None if findings else distance / DEMO_SPEED_MPH * 60,
        assumed_speed_mph=DEMO_SPEED_MPH,
        findings=findings,
        restrictions=areas,
        airspace_retrieved_at=retrieved_at,
    )


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
