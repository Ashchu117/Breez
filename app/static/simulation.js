export async function simulateMission(mission, signal, { detour = false } = {}) {
  const coordinates = ({ lat, lon }) => ({ lat, lon });
  const place = ({ name, address = "", lat, lon }) => ({ name, address, lat, lon });
  const { origin, destination } = mission;
  const input = mission.mode === "trip"
    ? { mode: "trip", origin: coordinates(origin), destination: coordinates(destination) }
    : { origin: place(origin), destination: place(destination), cargo: mission.items, timing: mission.timing };

  const unavailable = detour ? "The detour search is unavailable. Try again." :
    "The route simulation is unavailable. Try again or save your draft.";
  let response;
  let result;
  try {
    response = await fetch(detour ? "/api/route-alternative" : "/api/route-simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, confirmed: true }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    result = await response.json();
  } catch {
    throw new Error(unavailable);
  }

  if (!response.ok) {
    throw new Error(response.status === 422 && typeof result?.detail === "string" ? result.detail : unavailable);
  }
  if (detour && result === null) return null;
  if (!result.airspace_retrieved_at) {
    throw new Error("FAA airspace data is unavailable. Try again or save your draft.");
  }
  return result;
}
