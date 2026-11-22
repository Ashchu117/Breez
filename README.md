# Breez

Advanced Air Mobility System for Florida Poly Hackathon 2026.

## Run locally

Use Python 3.10 or later.

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Open http://127.0.0.1:8000 for the homepage or http://127.0.0.1:8000/docs for the API docs. The `/health` endpoint returns `{"status":"ok"}`.

## Project layout

- `main.py` creates the FastAPI app and registers routes and static files.
- `app/routes.py` defines the homepage and health check. `app/air_traffic.py` serves the Lakeland aircraft snapshot.
- `app/pages/` contains HTML pages and `app/static/` contains assets.
- `requirements.txt` lists the Python dependencies.

Push source changes to `main` for the palserver sync to pick up.

## Trip search and location

Breez asks for a starting point when someone starts a trip or food order. Choose Florida Polytechnic University, search by place or address, or use device location on HTTPS or localhost. Started plans use a Florida origin. Both starting-point and destination suggestions are filtered to Florida and biased toward a half-degree grid near the origin. Photon provides places, streets, and mapped address points. Numbered searches also use the free public [U.S. Census Bureau Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) for address-range estimates. Breez sends these lookups in a POST body and does not persist the submitted query on its server. Deerfield Beach searches recognize Little Harbor Way and Northeast 11th Way as names for the same road. Exact device coordinates stay in browser memory and straight-line distances are calculated locally. The boundary comes from the [U.S. Census Bureau’s generalized 2025 state layer](https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2025/State_County/MapServer/7).

The [Photon demo](https://github.com/komoot/photon#demo-server) is for light usage. Photon is Apache-2.0; its OpenStreetMap data retains ODbL attribution. Results preserve distinct branches. The two [LoveBird locations](https://www.lovebirdeats.com/) are provided locally because the demo index only returns the Lakeland branch. The Winter Haven coordinate is a [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/) address estimate.

## Hackathon demo delivery

Choose **Order food → Try a sample delivery** to skip location sharing. The preset uses two fictional hubs in Lakeland and Winter Haven. Review the stops, edit the cargo and timing, then save a sample draft. Breez draws pickup and drop-off pins and stores the sample in the current browser tab, alongside any regular drafts. The sample mission has `mode`, `source`, `origin`, `destination`, `cargo`, and `timing` fields for the next intake step. Route checks and the concierge are still to be connected.

## Homepage data and licensing

Guests can browse the map and draft a trip or delivery. Drafts stay in the current browser tab and survive a reload when tab storage is available. Booking and checkout will require sign-in once those flows are implemented.

- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) uses the BSD 3-Clause license. The homepage loads a pinned build.
- [OpenFreeMap](https://openfreemap.org/) allows commercial use of its public map service. The map credits OpenFreeMap, OpenMapTiles, and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The underlying OpenStreetMap data is licensed under the ODbL.
- [adsb.lol](https://www.adsb.lol/docs/open-data/api) publishes aircraft data under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve attribution and observe the share-alike terms for any publicly used adaptations of the database. The unauthenticated service is best-effort and has a per-IP quota. Breez caches each half-degree Florida traffic region for four minutes per Uvicorn worker, retains no history, and includes the rounded center and upstream source in the API response. Each worker budgets 450 requests per UTC day. The map reloads the feed when an accepted starting point changes. Account for shared egress and all workers when checking the quota.
