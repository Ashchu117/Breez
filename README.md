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

Breez asks for a starting point when someone starts a trip or food order. Choose Florida Polytechnic University, search by place or address, or use device location on HTTPS or localhost. Started plans use a Florida origin. Both starting-point and destination suggestions are filtered to Florida and biased toward a half-degree grid near the origin. Photon provides places, streets, and mapped address points. Numbered searches use the [U.S. Census Bureau’s TIGERweb roads](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer) to complete partially typed street names and the free public [U.S. Census Bureau Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) for address-range estimates. Breez sends these lookups in a POST body and does not persist the submitted query on its server. Deerfield Beach searches recognize Little Harbor Way and Northeast 11th Way as names for the same road. Straight-line search distances are calculated in the browser. Selecting a route simulation sends the chosen coordinates to Breez's backend for evaluation. Exact device coordinates are omitted from saved drafts. The boundary comes from the [U.S. Census Bureau’s generalized 2025 state layer](https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2025/State_County/MapServer/7).

[Photon](https://github.com/komoot/photon#license) is Apache-2.0 and supplies native search-as-you-type for places and mapped addresses. Its OpenStreetMap data is commercially reusable under ODbL, with attribution and applicable share-alike obligations. The [komoot demo instance](https://github.com/komoot/photon#demo-server) allows reasonable project traffic and can throttle requests. U.S. Census road and address-range APIs supplement its coverage, and the [TIGERweb places API](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer) can suggest Florida cities and census-designated places when Photon has no results. [Census public data policy](https://www.census.gov/about/policies/open-gov.html) Results preserve distinct branches. The two [LoveBird locations](https://www.lovebirdeats.com/) are provided locally because the demo index only returns the Lakeland branch. The Winter Haven coordinate is a [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/) address estimate.

## Food order demo

Choose **Order food**, set a Florida drop-off point, then pick McDonald’s, Wendy’s, or Burger King and a mapped restaurant. Browse the mock menu, customize placeholder items, and review and save the order draft. The map marks the restaurant pickup and delivery drop-off. Checkout and restaurant integrations are outside the demo.

Restaurant search uses Photon’s OpenStreetMap fast-food data through the same public demo service as place search. It filters results by chain and the Florida boundary. Local fallback addresses are from the [McDonald’s](https://www.mcdonalds.com/us/en-us/restaurant-directory/florida/lakeland.html), [Wendy’s](https://locations.wendys.com/united-states/fl/lakeland), and [Burger King](https://www.bk.com/store-locator) locators with Census address estimates. Search coverage depends on mapped branches.

**Describe your trip with AI** extracts a named destination or a supported place category from a plain-language request and asks a follow-up when needed. Category search uses [Photon’s category filters](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [OpenStreetMap data](https://www.openstreetmap.org/copyright), and U.S. Census city boundaries. Results are ranked by straight-line distance from the selected start. Choose a Florida search result before simulating the trip.

The delivery draft contains a restaurant pickup, drop-off, items, custom options, quantities, and timing. Choose **Describe your order with AI** to populate this draft from plain language and answer follow-up questions. After simulating a route, choose **Explain this route** for an AI briefing, then record **Approve for simulation** or **Hold**. The decision applies to the displayed candidate for the current review. Exact device coordinates are omitted from saved tab drafts.

## Concierge and route simulation

See the [delivery contracts](docs/delivery-contracts.md) for the model choice, proposed budget, and Python request and response schemas.

## Florida advanced air mobility references

See the [AAM project context](docs/aam-context.md) for Florida and federal references that inform the route simulation and judging demo.

## Homepage data and licensing

Guests can browse the map and draft a trip or delivery. Each home action starts a fresh plan. Multiple trip and delivery drafts stay in the current browser tab and survive a reload when tab storage is available. **Save trip draft** and **Save order draft** on the route preview remember the selected direct route or detour. Reopening checks it against the current FAA snapshot. Breez asks for the trip start or delivery drop-off again when the draft used device location. Booking and checkout will require sign-in once those flows are implemented.

- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) uses the BSD 3-Clause license. The homepage loads a pinned build.
- [OpenFreeMap](https://openfreemap.org/) allows commercial use of its public map service. The map credits OpenFreeMap, OpenMapTiles, and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The underlying OpenStreetMap data is licensed under the ODbL.
- FAA airspace screening uses published FAA National Security UAS Flight Restrictions and prohibited/restricted Special Use Airspace. The route results show the date of the Florida-area snapshot. [FAA data sources and refresh instructions](docs/delivery-contracts.md#run-a-route-simulation)
- [adsb.lol](https://www.adsb.lol/docs/open-data/api) publishes aircraft data under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve attribution and observe the share-alike terms for any publicly used adaptations of the database. The unauthenticated service is best-effort and has a per-IP quota. Breez refreshes each half-degree Florida traffic region every four minutes per Uvicorn worker and retries temporary failures after 30 seconds, subject to the provider’s rate-limit backoff. It keeps the last successful snapshot in memory for up to 15 minutes and labels it as delayed when a refresh fails. The route simulator uses the FAA snapshot independently of the aircraft feed. Each worker budgets 450 requests per UTC day. The map reloads the feed when an accepted starting point changes. Account for shared egress and all workers when checking the quota.
