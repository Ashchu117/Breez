import { createPlaceSearch, isPlace } from "./places.js?v=3";

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
let selectedDestination;
let startingPoint = null;
const tripSearch = createPlaceSearch({
  input: planInput,
  list: document.querySelector("#destination-results"),
  status: document.querySelector("#destination-status"),
  getOrigin: () => startingPoint,
  onSelect: (place) => { selectedDestination = place; },
  onType: () => { selectedDestination = null; },
});

function loadDrafts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "{}");
    return new Map(Object.keys(planTypes).flatMap((type) => {
      const value = saved?.[type];
      const detail = typeof value === "string" ? value : value?.detail;
      if (typeof detail !== "string" || !detail.trim() || detail.length > 240) return [];
      return [[type, { detail, place: isPlace(value?.place) ? value.place : null }]];
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
  const draft = drafts.get(type);
  selectedDestination = draft?.place ?? null;
  planInput.value = draft?.detail ?? "";
  planInput.setCustomValidity("");
  tripSearch.setEnabled(type === "trip");
  document.querySelector("#trip-search").hidden = type !== "trip";
  document.querySelector("#distance-note").textContent = startingPoint
    ? "Distances are straight-line estimates." : "Set a starting point to see distances.";
  document.querySelector("#destination-status").textContent = selectedDestination?.address ?? "";
  dialog.showModal();
}

function renderDrafts() {
  draftSection.hidden = drafts.size === 0;
  draftList.replaceChildren();
  for (const [type, draft] of drafts) {
    const row = document.createElement("li");
    row.className = "draft";
    const description = document.createElement("span");
    description.textContent = `${planTypes[type].summary}: ${draft.detail}`;
    if (draft.place?.address) {
      const address = document.createElement("small");
      address.textContent = draft.place.address;
      description.append(address);
    }
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
dialog.addEventListener("close", tripSearch.reset);
planInput.addEventListener("input", () => planInput.setCustomValidity(""));
document.querySelector("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const detail = planInput.value.trim();
  if (!detail) {
    planInput.setCustomValidity("Enter a destination or item to save a draft.");
    planInput.reportValidity();
    return;
  }
  drafts.set(selectedPlan, { detail, place: selectedPlan === "trip" ? selectedDestination : null });
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

const locationDialog = document.querySelector("#location-dialog");
const originInput = document.querySelector("#origin-search");
const locationNote = document.querySelector("#location-note");
const locationButton = document.querySelector("#change-origin");
const useLocation = document.querySelector("#use-location");
const canLocate = window.isSecureContext && Boolean(navigator.geolocation);
let locationAttempt = 0;
let mapStarted = false;

function setStartingPoint(point) {
  startingPoint = point;
  locationButton.textContent = point?.name ?? "Set starting point";
  locationDialog.close();
}

const originSearch = createPlaceSearch({
  input: originInput,
  list: document.querySelector("#origin-results"),
  status: document.querySelector("#origin-status"),
  onSelect: setStartingPoint,
});

function askForLocation() {
  originInput.value = "";
  originSearch.reset();
  useLocation.disabled = !canLocate;
  locationNote.textContent = canLocate ? "" : "Device location requires HTTPS. You can search below.";
  locationDialog.showModal();
  if (!canLocate) originInput.focus();
}

useLocation.addEventListener("click", () => {
  const attempt = ++locationAttempt;
  useLocation.disabled = true;
  locationNote.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    if (attempt !== locationAttempt || !locationDialog.open) return;
    setStartingPoint({ name: "Current location", lat: coords.latitude, lon: coords.longitude });
  }, (error) => {
    if (attempt !== locationAttempt || !locationDialog.open) return;
    useLocation.disabled = false;
    locationNote.textContent = error.code === 1
      ? "Location permission was declined. Search for a starting point below."
      : "Couldn’t get your location. Search for a starting point below.";
  }, { timeout: 10_000, maximumAge: 60_000 });
});

locationButton.addEventListener("click", askForLocation);
document.querySelector("#skip-location").addEventListener("click", () => setStartingPoint(null));
locationDialog.addEventListener("close", () => {
  locationAttempt++;
  originSearch.reset();
  if (!mapStarted) {
    mapStarted = true;
    startMap();
  }
});

askForLocation();
