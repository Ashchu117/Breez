import json
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException, Response

from app.concierge import route_briefing
from app.mission_contracts import BriefingRequest, RouteBriefing


class RouteBriefingTests(TestCase):
    def request(self, candidate, origin=(28.18, -81.82), destination=(26.32, -80.09)):
        return BriefingRequest(
            origin={"lat": origin[0], "lon": origin[1]},
            destination={"lat": destination[0], "lon": destination[1]},
            confirmed=True,
            candidate=candidate,
        )

    def test_briefing_sends_computed_facts_without_coordinates(self):
        with patch("app.concierge.request_model", return_value=RouteBriefing(explanation="The route overlaps listed airspace.")) as provider:
            for candidate, expected in (("direct", "blocked"), ("detour", "no_listed_overlap")):
                with self.subTest(candidate=candidate):
                    response = Response()
                    result = route_briefing(self.request(candidate), response)
                    self.assertTrue(result.explanation)
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
                    prompt = json.loads(provider.call_args.args[0])["messages"][-1]["content"]
                    facts = json.loads(prompt)
                    self.assertEqual(facts["status"], expected)
                    self.assertNotIn("28.18", prompt)
                    self.assertNotIn("-80.09", prompt)
                    if candidate == "direct":
                        self.assertTrue(facts["overlapping_areas"])
                        self.assertIsNone(facts["eta_minutes"])
                    else:
                        self.assertEqual(facts["direct_status"], "blocked")
                        self.assertGreater(facts["eta_minutes"], 0)

    def test_missing_detour_never_calls_provider(self):
        request = self.request("detour", (28.61222, -80.80755), (28.3186, -80.6094))
        with patch("app.concierge.request_model") as provider:
            with self.assertRaises(HTTPException) as error:
                route_briefing(request, Response())
        self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_called()
