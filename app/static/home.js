import { createPlaceSearch, isPlace } from "./places.js?v=4";
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
  floridaOnly: true,
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
const locationButton = document.querySelector("#change-origin");
const useLocation = document.querySelector("#use-location");
const canLocate = window.isSecureContext && Boolean(navigator.geolocation);
const updateMap = startMap();
let locationAttempt = 0;
let pendingPlan = null;

async function setStartingPoint(point) {
  const attempt = ++locationAttempt;
  useLocation.disabled = true;
  locationNote.textContent = "Checking Florida coverage…";
  let supported;
  try {
    supported = point === floridaPoly || await isInFlorida(point);
  } catch {
    if (attempt === locationAttempt && locationDialog.open) {
      useLocation.disabled = !canLocate;
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
});

function askForLocation(type = null) {
  pendingPlan = type;
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
      ? "Location permission was declined. Search below or choose Florida Polytechnic University."
      : "Couldn’t get your location. Search below or choose Florida Polytechnic University.";
  }, { timeout: 10_000, maximumAge: 60_000 });
});

locationButton.addEventListener("click", () => askForLocation());
document.querySelector("#use-campus").addEventListener("click", () => setStartingPoint(floridaPoly));
document.querySelector("#cancel-location").addEventListener("click", () => locationDialog.close());
document.querySelector("#retry-location").addEventListener("click", () => coverageDialog.close());
coverageDialog.addEventListener("close", () => askForLocation(pendingPlan));
locationDialog.addEventListener("close", () => {
  locationAttempt++;
  originSearch.reset();
});
