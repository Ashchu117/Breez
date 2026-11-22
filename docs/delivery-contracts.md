# Breez delivery contracts

## Concierge provider and cost

Proposed for the hackathon: OpenAI Responses API with [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). FastAPI and the site run on palserver. The model extracts delivery requests and later explains Python's simulation results. The click-through order flow works independently.

Proposed shared budget: **US$5 total** for development and judging. Approve the budget before enabling paid calls. Luna's documented Standard rates are $0.10 per million uncached input tokens and $0.50 per million output tokens. At 4,000 input tokens and 800 output tokens per call, 500 calls cost about **$0.40** at those rates, or about **$0.45** if every input token is billed at the documented 30-minute cache-write rate. Output counts include reasoning tokens. Recheck rates before enabling billing.

When wiring the provider, use a dedicated server-side project, restrict it to the selected model, and set a $5 project hard limit and a $3 alert if available. [OpenAI's project limits](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform) may take time to enforce. Keep a shared, durable cap of 500 attempted calls across palserver workers for the event. Count retries against that cap. Bound every full prompt to 4,000 input tokens, cap output at 800, and leave paid tools disabled. Keep the manual flow available once the cap is reached. These controls are work for the provider integration.

## Python request and response models

The canonical models are in [app/mission_contracts.py](../app/mission_contracts.py).

| Boundary | Request | Response |
| --- | --- | --- |
| Concierge from the browser | Current message and previous extracted fields, if any | Extracted fields for the next turn, resolved draft, missing field names, and one follow-up when needed |
| Model extraction | A request and the relevant prior answers | Pickup and drop-off names, cargo lines, and timing. Every key is present. Unknown values are `null`. |
| Python simulation | A confirmed draft with both resolved locations, cargo, and timing | Ordered map points, distance, ETA when the candidate passes, assumed speed, and structured blocking findings |

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

Breez’s place lookup resolves coordinates. If multiple branches match, the resolved `origin` stays `null` until the user picks one. Python computes which fields are missing. Timing uses the two options in the current menu, **As soon as possible** and **Within one hour**. A user preference outside those options needs clarification.

The existing order draft already provides `origin`, `destination`, `items`, and `timing`. The browser will map `items` to `cargo` and send each selected place's `name`, `address`, `lat`, and `lon`. The browser retains the chain and menu metadata. A device drop-off deliberately omitted from saved tab storage must be chosen again. Use public places for the judged demo and keep device coordinates out of model prompts.

The route engine owns the simulated findings, ETA, and status. A blocked result has a reason code, a simulated zone ID, and the zero-based index of the affected segment between consecutive map points. The model’s briefing consumes the result as data. The human review action is separate from the engine’s status. Both passing and blocked scenarios are simulations.
