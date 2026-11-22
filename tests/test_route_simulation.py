from unittest import TestCase

from pydantic import ValidationError

from app.mission_contracts import RouteRequest, TripRouteRequest
from app.route_simulation import DEMO_RESTRICTION, simulate_route


class RouteSimulationTests(TestCase):
    def mission(self, origin: dict | None = None, **changes) -> RouteRequest:
        payload = {
            "origin": origin or {
                "name": "South Lakeland demo pickup",
                "address": "",
                "lat": 27.99247,
                "lon": -81.95707,
            },
            "destination": {
                "name": "Florida Polytechnic University",
                "address": "",
                "lat": 28.1477054,
                "lon": -81.8487852,
            },
            "cargo": [{"name": "Food item 1", "quantity": 2, "options": []}],
            "timing": "Within one hour",
            "confirmed": True,
        }
        payload.update(changes)
        return RouteRequest.model_validate(payload)

    def test_passing_route(self):
        result = simulate_route(self.mission())
        self.assertTrue(result.simulation)
        self.assertEqual(result.status, "passes_demo_checks")
        self.assertAlmostEqual(result.distance_miles, 12.58, places=1)
        self.assertAlmostEqual(result.eta_minutes, result.distance_miles * 60 / result.assumed_speed_mph)
        self.assertEqual(result.findings, [])
        self.assertEqual(result.restrictions, [DEMO_RESTRICTION])

    def test_blocked_route_reports_segment_without_eta(self):
        mission = self.mission(origin={
            "name": "North Lakeland demo pickup",
            "address": "",
            "lat": 28.12009,
            "lon": -81.97385,
        })
        result = simulate_route(mission)
        self.assertEqual(result.status, "blocked")
        self.assertIsNone(result.eta_minutes)
        self.assertEqual(len(result.findings), 1)
        finding = result.findings[0]
        self.assertEqual(finding.code, "SIMULATED_RESTRICTION")
        self.assertEqual(finding.zone_id, DEMO_RESTRICTION.id)
        self.assertEqual(finding.segment_index, 0)

    def test_trip_preview_uses_coordinates(self):
        delivery = self.mission()
        trip = TripRouteRequest(
            mode="trip",
            origin={"lat": delivery.origin.lat, "lon": delivery.origin.lon},
            destination={"lat": delivery.destination.lat, "lon": delivery.destination.lon},
            confirmed=True,
        )
        self.assertEqual(simulate_route(trip), simulate_route(delivery))

    def test_incomplete_or_unconfirmed_missions_are_rejected(self):
        for changes in ({"timing": None}, {"confirmed": False}, {"confirmed": 1}, {"cargo": []}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.mission(**changes)

    def test_invalid_pickup_or_dropoff_is_rejected(self):
        mission = self.mission()
        destinations = [
            mission.origin,
            {"name": "Non-Florida test point", "address": "", "lat": 33.75, "lon": -84.38},
        ]
        for destination in destinations:
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                simulate_route(self.mission(destination=destination))
