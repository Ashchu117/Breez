const planTypes = {
  trip: { title: "Plan a trip", label: "Where do you want to go?", placeholder: "Enter a destination", summary: "Trip draft" },
  delivery: { title: "Plan a delivery", label: "What would you like to order?", placeholder: "Enter an item", summary: "Delivery draft" },
};
const drafts = new Map();
const dialog = document.querySelector("#plan-dialog");
const planInput = document.querySelector("#plan-detail");
const draftList = document.querySelector("#drafts");
let selectedPlan;

function openPlan(type) {
  selectedPlan = type;
  const plan = planTypes[type];
  document.querySelector("#dialog-title").textContent = plan.title;
  document.querySelector("#detail-label").textContent = plan.label;
  planInput.placeholder = plan.placeholder;
  planInput.value = drafts.get(type) ?? "";
  planInput.setCustomValidity("");
  dialog.showModal();
}

function renderDrafts() {
  draftList.replaceChildren();
  for (const [type, detail] of drafts) {
    const row = document.createElement("div");
    row.className = "draft";
    const description = document.createElement("span");
    description.textContent = `${planTypes[type].summary}: ${detail}`;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${planTypes[type].summary.toLowerCase()}`);
    edit.addEventListener("click", () => openPlan(type));
    row.append(description, edit);
    draftList.append(row);
  }
}

for (const button of document.querySelectorAll("[data-plan]")) {
  button.addEventListener("click", () => openPlan(button.dataset.plan));
}

document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
planInput.addEventListener("input", () => planInput.setCustomValidity(""));
document.querySelector("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const detail = planInput.value.trim();
  if (!detail) {
    planInput.setCustomValidity("Enter a destination or item to save a draft.");
    planInput.reportValidity();
    return;
  }
  drafts.set(selectedPlan, detail);
  renderDrafts();
  dialog.close();
  document.querySelector(`[data-plan="${selectedPlan}"]`).focus();
});

const trafficStatus = document.querySelector("#traffic-status");
const MAX_SNAPSHOT_AGE = 6 * 60 * 1000;
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function startMap() {
  if (!window.maplibregl) {
    trafficStatus.textContent = "Map unavailable";
    return;
  }

  let map;
  try {
    map = new maplibregl.Map({
      container: "traffic-map",
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [-81.85, 28.15],
      zoom: 8.5,
      minZoom: 6,
      maxZoom: 15,
      maxBounds: [[-84.4, 26.2], [-79.3, 30]],
      attributionControl: false,
      scrollZoom: false,
    });
  } catch {
    trafficStatus.textContent = "Map unavailable";
    return;
  }

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  let markers = [];
  let pending = false;

  function clearMarkers() {
    for (const marker of markers) marker.remove();
    markers = [];
  }

  async function refreshTraffic() {
    if (pending || document.hidden) return;
    pending = true;
    try {
      const response = await fetch("/api/air-traffic", { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Aircraft feed unavailable");
      const snapshot = await response.json();
      if (!Number.isFinite(snapshot.observed_at) || Date.now() - snapshot.observed_at > MAX_SNAPSHOT_AGE) {
        throw new Error("Aircraft feed is stale");
      }

      clearMarkers();
      for (const aircraft of snapshot.aircraft) {
        const marker = document.createElement("span");
        marker.className = aircraft.heading === null ? "aircraft aircraft-stationary" : "aircraft";
        marker.setAttribute("aria-hidden", "true");
        markers.push(new maplibregl.Marker({
          element: marker,
          rotation: aircraft.heading ?? 0,
          rotationAlignment: "map",
        }).setLngLat([aircraft.longitude, aircraft.latitude]).addTo(map));
      }
      trafficStatus.textContent = `${markers.length} aircraft in range · ${timeFormatter.format(snapshot.observed_at)}`;
    } catch {
      clearMarkers();
      trafficStatus.textContent = "Aircraft data unavailable";
    } finally {
      pending = false;
    }
  }

  let ready = false;
  map.on("error", () => {
    if (!ready) trafficStatus.textContent = "Map unavailable";
  });
  map.once("load", () => {
    ready = true;
    refreshTraffic();
    window.setInterval(refreshTraffic, 60_000);
    document.addEventListener("visibilitychange", refreshTraffic);
  });
}

startMap();
