# Breez delivery contracts

## Try Breez

For local setup, follow the [README](../README.md#run-locally). To enable the AI features, set `OPENROUTER_API_KEY` and set `BREEZ_CONCIERGE_STATE_DIR` to a writable directory outside the checkout before starting Uvicorn. Keep your API key out of source control. Manual planning and route simulation work without AI credentials.

In the app, choose **Order food**, set a Florida drop-off, and select a restaurant and mock menu items. **Describe your order with AI** can fill the order from plain language and ask for missing details. Confirm the branch and review the cart before simulating a route.

## API

Open the running app's `/docs` page for the interactive API reference. The request and response models are defined in [app/mission_contracts.py](../app/mission_contracts.py).

| Endpoint | Purpose |
| --- | --- |
| `POST /api/concierge` | Extract order details from a message and any previous answers. |
| `POST /api/route-simulation` | Screen a confirmed trip or delivery and return map points, distance, overlap findings, and an estimated travel time if the route passes the check. |
| `POST /api/route-alternative` | Find a detour for a confirmed trip or delivery. Returns `null` if no detour is found. |
| `POST /api/route-briefing` | Explain the computed results for the selected candidate. The briefing prompt uses the computed screening outcome, intersecting area names, distance, and estimated time. |

## Run a route simulation

For a delivery example, choose Florida Polytechnic University as the drop-off and the Wendy's at 3929 S Florida Ave in Lakeland as the pickup. For an airspace-overlap example, try a trip from Titusville to Cocoa Beach.

Breez checks horizontal overlap with a dated FAA snapshot. Estimated travel time assumes a constant 40 mph and excludes takeoff, landing, and loading. **Explain this route** summarizes the results. Reviewers can select **Hold** or approve a candidate for simulation after it passes the overlap check. The live aircraft overlay provides map context. Weather, altitude, activation schedules, live aircraft conflicts, and current flight restrictions are outside the simulation's scope.

- [FAA National Security UAS Flight Restrictions](https://udds-faa.opendata.arcgis.com/datasets/0270b9d8a5d34217856cc03aaf833309_0)
- [FAA Special Use Airspace](https://adds-faa.opendata.arcgis.com/datasets/dd0d1b726e504137ab3c41b21835d05b_0)

To refresh the bundled FAA snapshot, run `python scripts/update_faa_airspace.py` from the repo root and restart the app.
