import { createPlaceSearch, isPlace } from "./places.js?v=5";
import { floridaPoly, isInFlorida } from "./geography.js?v=1";
import { startMap } from "./traffic.js?v=1";

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
    edit.addEventListener("click", () => startingPoint ? openPlan(type) : askForLocation(type));
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
  button.addEventListener("click", () => askForLocation(button.dataset.plan));
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

const locationDialog = document.querySelector("#location-dialog");
const coverageDialog = document.querySelector("#coverage-dialog");
const originInput = document.querySelector("#origin-search");
const locationNote = document.querySelector("#location-note");
const locationPermission = document.querySelector("#location-permission");
const locationButton = document.querySelector("#change-origin");
const useLocation = document.querySelector("#use-location");
const canLocate = window.isSecureContext && Boolean(navigator.geolocation);
const updateMap = startMap();
let locationAttempt = 0;
let pendingPlan = null;
let locationBusy = false;
let permissionState;
let stopDeviceWatch;

function cancelDeviceWatch() {
  if (!stopDeviceWatch) return;
  stopDeviceWatch();
  stopDeviceWatch = undefined;
  locationAttempt++;
}

function updateLocationButton() {
  useLocation.disabled = !canLocate || locationBusy || permissionState === "denied";
}

function showPermission(state) {
  permissionState = state;
  locationPermission.dataset.state = state;
  locationPermission.textContent = {
    granted: "Location permission granted.",
    denied: "Location access is blocked. Check this site’s browser permissions.",
    prompt: "Your browser may ask for permission when you use your location.",
  }[state] ?? "";
  updateLocationButton();
}

async function watchLocationPermission() {
  if (!canLocate || !navigator.permissions?.query) return;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    showPermission(status.state);
    status.addEventListener("change", () => showPermission(status.state));
  } catch {
    // Browsers without a geolocation permission query can still locate on click.
  }
}

function setLocationBusy(busy) {
  locationBusy = busy;
  updateLocationButton();
}

watchLocationPermission();

async function setStartingPoint(point) {
  cancelDeviceWatch();
  const attempt = ++locationAttempt;
  setLocationBusy(true);
  locationNote.textContent = "Checking Florida coverage…";
  let supported;
  try {
    supported = point === floridaPoly || await isInFlorida(point);
  } catch {
    if (attempt === locationAttempt && locationDialog.open) {
      setLocationBusy(false);
      locationNote.textContent = "Couldn’t verify that location. Try again or use Florida Polytechnic University.";
    }
    return;
  }

  if (attempt !== locationAttempt || !locationDialog.open) return;
  locationDialog.close();
  if (!supported) {
    coverageDialog.showModal();
    return;
  }

  startingPoint = point;
  locationButton.textContent = point.name;
  updateMap(point);
  const plan = pendingPlan;
  pendingPlan = null;
  if (plan) openPlan(plan);
}

const originSearch = createPlaceSearch({
  input: originInput,
  list: document.querySelector("#origin-results"),
  status: document.querySelector("#origin-status"),
  onSelect: setStartingPoint,
  onType: () => {
    if (!stopDeviceWatch) return;
    cancelDeviceWatch();
    setLocationBusy(false);
    locationNote.textContent = "";
  },
});

function askForLocation(type = null) {
  pendingPlan = type;
  originInput.value = "";
  originSearch.reset();
  setLocationBusy(false);
  locationNote.textContent = !window.isSecureContext
    ? "Device location requires HTTPS. You can search below."
    : canLocate ? "" : "This browser cannot provide device location. You can search below.";
  locationDialog.showModal();
  if (useLocation.disabled) originInput.focus();
}

function requestDeviceLocation() {
  const attempt = ++locationAttempt;
  const isCurrent = () => attempt === locationAttempt && locationDialog.open;
  setLocationBusy(true);
  locationNote.textContent = "Getting your location…";

  const waiting = setTimeout(() => {
    if (isCurrent()) locationNote.textContent = "Still waiting on your device. You can search below or choose Florida Polytechnic University.";
  }, 8_000);
  const deadline = setTimeout(() => {
    fail("Your device didn’t provide a location. Check device location services, or search below.");
  }, 45_000);

  let watchId;
  stopDeviceWatch = () => {
    clearTimeout(waiting);
    clearTimeout(deadline);
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  };

  function fail(message) {
    if (!isCurrent()) return;
    cancelDeviceWatch();
    setLocationBusy(false);
    locationNote.textContent = message;
  }

  try {
    watchId = navigator.geolocation.watchPosition(({ coords }) => {
      if (!isCurrent()) return;
      showPermission("granted");
      setStartingPoint({ name: "Current location", lat: coords.latitude, lon: coords.longitude });
    }, (error) => {
      if (!isCurrent() || error.code !== 1) return;
      fail(permissionState === "granted"
        ? "Your device blocked location access. Check device location services, or search below."
        : "Location access was blocked. Check this site’s browser permission, or search below.");
    }, { maximumAge: 5 * 60_000, enableHighAccuracy: false });
  } catch {
    fail("Your browser couldn’t start location lookup. Search below or choose Florida Polytechnic University.");
  }
}

useLocation.addEventListener("click", requestDeviceLocation);

locationButton.addEventListener("click", () => askForLocation());
document.querySelector("#use-campus").addEventListener("click", () => setStartingPoint(floridaPoly));
document.querySelector("#cancel-location").addEventListener("click", () => locationDialog.close());
document.querySelector("#retry-location").addEventListener("click", () => coverageDialog.close());
coverageDialog.addEventListener("close", () => askForLocation(pendingPlan));
locationDialog.addEventListener("close", () => {
  cancelDeviceWatch();
  locationAttempt++;
  setLocationBusy(false);
  originSearch.reset();
});
