from unittest import TestCase
from unittest.mock import patch
from urllib.error import URLError

from fastapi import HTTPException, Response

from app import air_traffic


class AircraftFeedTests(TestCase):
    def test_recent_positions_survive_failed_refresh_and_expire(self):
        snapshot = {"observed_at": 1_000_000, "aircraft": [], "region": {"lat": 28, "lon": -82}}
        recovered = {**snapshot, "observed_at": 1_272_000}
        upstream = [snapshot, URLError("temporary outage"), recovered, URLError("still offline")]
        with (
            patch.object(air_traffic, "regions", {}),
            patch.object(air_traffic, "time", return_value=1000) as wall,
            patch.object(air_traffic, "monotonic", return_value=100) as clock,
            patch.object(air_traffic, "reserve_request", return_value=True),
            patch.object(air_traffic, "read_snapshot", side_effect=upstream) as fetch,
        ):
            def get():
                return air_traffic.air_traffic(Response(), 28, -82)

            self.assertFalse(get()["delayed"])
            wall.return_value, clock.return_value = 1241, 341
            self.assertEqual(get(), {**snapshot, "delayed": True})
            wall.return_value, clock.return_value = 1260, 360
            self.assertTrue(get()["delayed"])
            self.assertEqual(fetch.call_count, 2)
            wall.return_value, clock.return_value = 1272, 372
            self.assertEqual(get(), {**recovered, "delayed": False})
            wall.return_value, clock.return_value = 2173, 1273
            with self.assertRaises(HTTPException) as expired:
                get()
            self.assertEqual(expired.exception.status_code, 503)

    def test_uncached_region_retries_after_short_delay(self):
        with (
            patch.object(air_traffic, "regions", {}),
            patch.object(air_traffic, "monotonic", return_value=100) as clock,
            patch.object(air_traffic, "reserve_request", return_value=True),
            patch.object(air_traffic, "read_snapshot", side_effect=URLError("temporary outage")) as fetch,
        ):
            for tick in (100, 110, 131):
                clock.return_value = tick
                with self.assertRaises(HTTPException) as unavailable:
                    air_traffic.air_traffic(Response(), 28, -82)
                self.assertEqual(unavailable.exception.status_code, 503)
            self.assertEqual(fetch.call_count, 2)
