from unittest import TestCase
from unittest.mock import patch

from fastapi import Response

from app.concierge import trip_assist
from app.mission_contracts import TripAssistRequest, TripIntent


class TripAssistTests(TestCase):
    def mechanic(self, follow_up=None):
        return TripIntent(destination=None, category="car_repair", city="Lakeland", follow_up=follow_up)

    def test_generic_confirmation_keeps_resolved_category_and_city(self):
        previous = self.mechanic()
        with patch("app.concierge.request_model") as model:
            for message in ("help me find one", "Yes, search for me", "Sure"):
                with self.subTest(message=message):
                    request = TripAssistRequest(message=message, previous=previous)
                    self.assertEqual(trip_assist(request, Response()), previous)
            model.assert_not_called()

    def test_change_or_unresolved_question_uses_conversation_model(self):
        previous = self.mechanic()
        with patch("app.concierge.request_model", return_value=previous) as model:
            trip_assist(TripAssistRequest(message="Yes, search 33606", previous=previous), Response())
            pending = self.mechanic("Would you like to see general auto repair shops?")
            trip_assist(TripAssistRequest(message="Yes, search for me", previous=pending), Response())
            self.assertEqual(model.call_count, 2)
