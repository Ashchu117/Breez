from itertools import pairwise
from unittest import TestCase

from pydantic import ValidationError

from app.faa_airspace import intersects_area, nearby_airspace
from app.mission_contracts import RouteRequest, TripRouteRequest
from app.route_simulation import alternative_route, distance_miles, simulate_route


class RouteSimulationTests(TestCase):
    def mission(self, **changes) -> RouteRequest:
        payload = {
            "origin": {
                "name": "South Lakeland demo pickup", "address": "",
                "lat": 27.99247, "lon": -81.95707,
            },
            "destination": {
                "name": "Florida Polytechnic University", "address": "",
                "lat": 28.1477054, "lon": -81.8487852,
            },
            "cargo": [{"name": "Food item 1", "quantity": 2, "options": []}],
            "timing": "Within one hour",
            "confirmed": True,
        }
        payload.update(changes)
        return RouteRequest.model_validate(payload)

    def test_candidate_without_overlap_has_eta(self):
        result = simulate_route(self.mission())
        self.assertTrue(result.simulation)
        self.assertEqual(result.status, "no_listed_overlap")
        self.assertAlmostEqual(result.distance_miles, 12.58, places=1)
        self.assertAlmostEqual(result.eta_minutes, result.distance_miles * 60 / result.assumed_speed_mph)
        self.assertEqual(result.findings, [])
        self.assertTrue(result.airspace_retrieved_at)

    def test_cape_route_intersects_published_special_use_airspace(self):
        route = TripRouteRequest(
            mode="trip", confirmed=True,
            origin={"lat": 28.61222, "lon": -80.80755},
            destination={"lat": 28.3186, "lon": -80.6094},
        )
        result = simulate_route(route)
        self.assertEqual(result.status, "blocked")
        self.assertIsNone(result.eta_minutes)
        self.assertTrue(all(finding.segment_index == 0 for finding in result.findings))
        self.assertTrue(all(finding.code == "FAA_AIRSPACE_OVERLAP" for finding in result.findings))
        finding_ids = {finding.zone_id for finding in result.findings}
        self.assertIn("R-2935", {area.name for area in result.restrictions if area.id in finding_ids})

    def test_keys_route_intersects_published_uas_restriction(self):
        route = TripRouteRequest(
            mode="trip", confirmed=True,
            origin={"lat": 24.5551, "lon": -81.78},
            destination={"lat": 24.5976, "lon": -81.6609},
        )
        result = simulate_route(route)
        self.assertEqual(result.status, "blocked")
        finding_ids = {finding.zone_id for finding in result.findings}
        self.assertIn("Boca Chica", {
            area.name for area in result.restrictions if area.id in finding_ids and area.kind == "uas_security"
        })

    def test_detour_around_published_faa_airspace(self):
        route = TripRouteRequest(
            mode="trip", confirmed=True,
            origin={"lat": 28.18, "lon": -81.82},
            destination={"lat": 26.32, "lon": -80.09},
        )
        direct = simulate_route(route)
        self.assertEqual(direct.status, "blocked")

        result = alternative_route(route)
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "no_listed_overlap")
        self.assertEqual(result.points[0], route.origin)
        self.assertEqual(result.points[-1], route.destination)
        self.assertGreater(len(result.points), 2)
        length = sum(distance_miles(start, end) for start, end in pairwise(result.points))
        self.assertAlmostEqual(result.distance_miles, length)
        self.assertAlmostEqual(result.eta_minutes, length / result.assumed_speed_mph * 60)
        self.assertGreaterEqual(length, direct.distance_miles)
        self.assertLess(length, direct.distance_miles * 1.1)
        for start, end in pairwise(result.points):
            _, areas = nearby_airspace([start, end])
            self.assertFalse(any(intersects_area(start, end, area) for area in areas))

    def test_detour_unavailable_with_endpoint_inside_published_airspace(self):
        route = TripRouteRequest(
            mode="trip", confirmed=True,
            origin={"lat": 28.61222, "lon": -80.80755},
            destination={"lat": 28.3186, "lon": -80.6094},
        )
        self.assertIsNone(alternative_route(route))

    def test_alternative_returns_direct_route_when_clear(self):
        mission = self.mission()
        self.assertEqual(alternative_route(mission), simulate_route(mission))

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
