# Breez delivery contracts

## Concierge provider and cost

Breez uses the hackathon's sponsored OpenRouter key with [GPT-6 Luna](https://openrouter.ai/openai/gpt-6-luna) and [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs). The app, map, and planned route simulation run on palserver. The concierge extracts free text, asks for missing details, and hands the order to the existing branch picker and cart. Explaining route results comes after the simulation is implemented.

OpenRouter lists Standard rates of $0.10 per million input tokens and $0.50 per million output tokens for Luna. Breez caps the total attempt count at 500 and limits the request size and generated output. At 4,000 input and 800 output tokens each, 500 calls would use about $0.40 in sponsor credits at those rates. The application has no paid backup key configured.

## Python request and response models

The canonical models are in [app/mission_contracts.py](../app/mission_contracts.py).

| Boundary | Request | Response |
| --- | --- | --- |
| Concierge from the browser | Current message and previous extracted fields, if any | Extracted fields for the next turn. The browser asks for missing details and resolves the pickup when the user selects a branch. |
| Model extraction | A request and the relevant prior answers | Pickup and drop-off names, cargo lines, and timing. Every key is present. Unknown values are `null`. |
| Python simulation | A confirmed draft with both resolved locations, cargo, and timing | Ordered map points, distance, ETA when the candidate passes, assumed speed, simulated restriction geometry, and structured blocking findings |

A user request like “Pick up two Food item 1s with Custom option 2 from Wendy’s for Florida Poly” could produce this extraction:

```json
{
  "origin": "Wendy’s",
  "destination": "Florida Polytechnic University",
  "cargo": [
    { "name": "Food item 1", "quantity": 2, "options": ["Custom option 2"] }
  ],
  "timing": null
}
```

Breez’s place lookup resolves coordinates. If multiple branches match, the resolved `origin` stays `null` until the user picks one. The browser checks for missing order details before offering the branch picker. Timing uses the two options in the current menu, **As soon as possible** and **Within one hour**. A user preference outside those options needs clarification.

The existing order draft already provides `origin`, `destination`, `items`, and `timing`. The browser will map `items` to `cargo` and send each selected place's `name`, `address`, `lat`, and `lon`. The browser retains the chain and menu metadata. A device drop-off deliberately omitted from saved tab storage must be chosen again. Use public places for the judged demo and keep device coordinates out of model prompts.

The route engine owns the simulated findings, ETA, and status. A blocked result has a reason code, a simulated zone ID, and the zero-based index of the affected segment between consecutive map points. The model’s briefing consumes the result as data. The human review action is separate from the engine’s status. Both passing and blocked scenarios are simulations.

## Run a route simulation

`POST /api/route-simulation` accepts the `RouteRequest` schema. Use `confirmed: true` and supply Florida pickup and drop-off coordinates, cargo, and one of the timing options. The endpoint returns HTTP 422 for a missing field, an unconfirmed mission, a location outside Florida, or identical pickup and drop-off coordinates.

The trip planner uses the same endpoint with `mode: "trip"`, `confirmed: true`, and `origin` and `destination` objects containing `lat` and `lon`. Trip previews use coordinates only. Cargo and timing apply to delivery requests.

The candidate is a direct segment. Breez calculates its great-circle distance and estimates travel time at a fixed 40 mph, excluding takeoff, landing, and loading. The only constraint is a fictional circle in Lakeland. The engine checks whether the segment touches or enters the circle in a local approximation, including at the endpoints. A blocked route has no ETA. The response includes the zone's center and radius for display and uses zero-based indexes to identify affected segments.

In the API docs, use Florida Polytechnic University (`28.1477054, -81.8487852`) as drop-off. A pickup near 3929 S Florida Ave (`27.99247, -81.95707`) passes the simulation. A pickup near 5740 Highway 98 North (`28.12009, -81.97385`) is blocked by the simulated zone. Each coordinate pair is latitude, longitude. Both examples are planning simulations.

## Enable the sponsored concierge on palserver

Breez uses Navarro's OpenRouter credits only for the concierge. [The workshop example](https://github.com/fpunavarro/connect-api-llm/blob/main/connect-api-llm/README.md) demonstrates the OpenAI-compatible API. Breez uses OpenRouter's Chat Completions endpoint with the existing extraction schema and leaves the manual menu available when the API is offline or credits are exhausted.

Run this from the palserver host as a sudo-capable admin after the Git sync. Paste the team key only when prompted. The root-only credential file stays outside both the checkout and the SSH chroot.

~~~bash
sudo bash -c 'umask 077; install -d -m 0700 /etc/breez; read -rsp "OpenRouter API key: " key; printf "\n"; [[ "$key" =~ ^sk-or-v1-[0-9a-f]{64}$ ]] || exit 1; printf "OPENROUTER_API_KEY=%s\n" "$key" > /etc/breez/openrouter.env'
sudo install -d /etc/systemd/system/breez.service.d
sudo tee /etc/systemd/system/breez.service.d/concierge.conf >/dev/null <<'EOF'
[Service]
EnvironmentFile=/etc/breez/openrouter.env
StateDirectory=breez
EOF
sudo systemctl daemon-reload
sudo systemctl restart breez.service
curl -fsS http://127.0.0.1:8000/health
~~~

The service stores its 500-attempt cap in SQLite under the systemd state directory. Each request is bounded before inference. Use a dedicated spending-capped team key for the public demo.

For local testing, set `OPENROUTER_API_KEY` and `BREEZ_CONCIERGE_STATE_DIR` to an existing writable folder outside the checkout before starting Uvicorn. The concierge stays offline when either setting is absent.
