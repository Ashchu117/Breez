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

Breez asks for a starting point on page load. Device location requires HTTPS or localhost. Visitors can also search for a starting point or continue without distances. The page calculates straight-line miles locally and sends typed place queries to Photon with a fixed Central Florida bias. It keeps device coordinates in memory for the page.

The [Photon demo](https://github.com/komoot/photon#demo-server) is for light usage. Photon is Apache-2.0; its OpenStreetMap data retains ODbL attribution. Results preserve distinct branches. The two [LoveBird locations](https://www.lovebirdeats.com/) are provided locally because the demo index only returns the Lakeland branch. The Winter Haven coordinate is a [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/) address estimate.

## Homepage data and licensing

Guests can browse the map and draft a trip or delivery. Drafts stay in the current browser tab and survive a reload when tab storage is available. Booking and checkout will require sign-in once those flows are implemented.

- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) uses the BSD 3-Clause license. The homepage loads a pinned build.
- [OpenFreeMap](https://openfreemap.org/) allows commercial use of its public map service. The map credits OpenFreeMap, OpenMapTiles, and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The underlying OpenStreetMap data is licensed under the ODbL.
- [adsb.lol](https://www.adsb.lol/docs/open-data/api) publishes aircraft data under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve attribution and observe the share-alike terms for any publicly used adaptations of the database. The unauthenticated service is best-effort and has a per-IP quota. Breez caches one snapshot for four minutes per Uvicorn worker, retains no history, and includes the upstream source in the API response. Account for shared egress and all workers when checking the quota.
