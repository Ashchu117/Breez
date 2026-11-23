from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi import Response
from pydantic import ValidationError

from app.trip_places import TripPlacesRequest, mapped_places, trip_places


class TripCategoryTests(TestCase):
    def test_new_category_filters_results_using_provider_tag(self):
        features = [{
            "properties": {"name": name, "osm_key": "shop", "osm_value": category},
            "geometry": {"type": "Point", "coordinates": [-81.95, 28.04]},
        } for name, category in [("Game shop", "video_games"), ("Other shop", "supermarket")]]
        with patch("app.trip_places.read_json", return_value={"features": features}) as lookup:
            results = mapped_places("shop:video_games", None, 28, -82, 0)
            query = parse_qs(urlsplit(lookup.call_args.args[0]).query)
            self.assertEqual(query["include"], ["osm.shop.video_games"])
            self.assertEqual([place.name for place in results], ["Game shop"])

    def test_legacy_category_is_forwarded_as_a_tag(self):
        payload = TripPlacesRequest(category="car_repair", city=None, region={"lat": 28, "lon": -82})
        with patch("app.trip_places.mapped_places", return_value=[]) as lookup:
            trip_places(payload, Response())
            self.assertEqual(lookup.call_args.args[0], "shop:car_repair")

    def test_filter_syntax_rejects_extra_parameters(self):
        with self.assertRaises(ValidationError):
            TripPlacesRequest(category="shop:video_games&include=airport", city=None,
                              region={"lat": 28, "lon": -82})
