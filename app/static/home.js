const planTypes = {
  trip: { title: "Plan a trip", label: "Where do you want to go?", placeholder: "Enter a destination", summary: "Trip draft" },
  delivery: { title: "Plan a delivery", label: "What would you like to order?", placeholder: "Enter an item", summary: "Delivery draft" },
};
const draftKey = "breez.planDrafts";
const drafts = loadDrafts();
const dialog = document.querySelector("#plan-dialog");
const planInput = document.querySelector("#plan-detail");
const draftSection = document.querySelector("#drafts");
const draftList = document.querySelector("#draft-list");
let selectedPlan;

function loadDrafts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "{}");
    return new Map(Object.keys(planTypes).flatMap((type) => {
      const detail = saved?.[type];
      return typeof detail === "string" && detail.trim() && detail.length <= 120 ? [[type, detail]] : [];
    }));
  } catch {
    return new Map();
  }
}

function persistDrafts() {
  try {
    sessionStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // Drafts remain available until the page closes if tab storage is disabled.
  }
}

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
  draftSection.hidden = drafts.size === 0;
  draftList.replaceChildren();
  for (const [type, detail] of drafts) {
    const row = document.createElement("li");
    row.className = "draft";
    const description = document.createElement("span");
    description.textContent = `${planTypes[type].summary}: ${detail}`;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${planTypes[type].summary.toLowerCase()}`);
    edit.addEventListener("click", () => openPlan(type));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${planTypes[type].summary.toLowerCase()}`);
    remove.addEventListener("click", () => {
      drafts.delete(type);
      persistDrafts();
      renderDrafts();
      document.querySelector(`[data-plan="${type}"]`).focus();
    });
    const actions = document.createElement("div");
    actions.className = "draft-actions";
    actions.append(edit, remove);
    row.append(description, actions);
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
  persistDrafts();
  renderDrafts();
  dialog.close();
  document.querySelector(`[data-plan="${selectedPlan}"]`).focus();
});

renderDrafts();

const trafficStatus = document.querySelector("#traffic-status");
const trafficPanel = document.querySelector(".traffic-info");
const recenter = document.querySelector("#recenter-map");
const homeView = { center: [-81.85, 28.15], zoom: 8.5 };
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
      ...homeView,
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
      trafficPanel.dataset.available = "true";
      trafficStatus.textContent = `${markers.length} aircraft in range · ${timeFormatter.format(snapshot.observed_at)}`;
    } catch {
      clearMarkers();
      delete trafficPanel.dataset.available;
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
    recenter.hidden = false;
    recenter.addEventListener("click", () => map.easeTo(homeView));
    refreshTraffic();
    window.setInterval(refreshTraffic, 60_000);
    document.addEventListener("visibilitychange", refreshTraffic);
  });
}

startMap();
