import { createPlaceSearch, isPlace } from "./places.js?v=8";
import { floridaPoly, isInFlorida } from "./geography.js?v=1";
import { startMap } from "./traffic.js?v=7";
import { createFoodOrder, readFoodMission } from "./food-order.js?v=7";
import { simulateMission } from "./simulation.js?v=3";

const planTypes = {
  trip: { title: "Plan a trip", label: "Where do you want to go?", placeholder: "Enter a destination", summary: "Trip draft" },
  delivery: { title: "Plan a delivery", label: "What would you like to order?", placeholder: "Enter an item", summary: "Delivery draft" },
};
const draftKey = "breez.planDrafts";
const drafts = loadDrafts();
const dialog = document.querySelector("#plan-dialog");
const planInput = document.querySelector("#plan-detail");
const simulateTrip = document.querySelector("#simulate-trip");
const tripProgress = document.querySelector("#trip-simulation-progress");
let tripRequest;
const draftSection = document.querySelector("#drafts");
const draftList = document.querySelector("#draft-list");
const draftStatus = document.querySelector("#draft-status");
let draftRequest;
let selectedPlan;
let selectedDestination;
let startingPoint = null;
const tripSearch = createPlaceSearch({
  input: planInput,
  list: document.querySelector("#destination-results"),
  status: document.querySelector("#destination-status"),
  getOrigin: () => startingPoint,
  onSelect: (place) => {
    selectedDestination = place;
    resetTripSimulation();
  },
  onType: () => {
    selectedDestination = null;
    resetTripSimulation();
  },
});

function loadDrafts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "{}");
    return new Map(Object.keys(planTypes).flatMap((type) => {
      const value = saved?.[type];
      const detail = typeof value === "string" ? value : value?.detail;
      if (typeof detail !== "string" || !detail.trim() || detail.length > 240) return [];
      const mission = type === "delivery" ? readFoodMission(value?.mission) : null;
      const place = isPlace(value?.place) ? value.place : null;
      const route = value?.preview;
      let preview = null;
      if (["direct", "detour"].includes(route?.candidate)) {
        if (type === "delivery" && mission) preview = { candidate: route.candidate };
        else if (type === "trip" && place) {
          const origin = isPlace(route.origin) && route.origin.kind !== "device" ? route.origin : null;
          preview = { candidate: route.candidate, origin };
        }
      }
      return [[type, { detail, place, mission, preview }]];
    }));
  } catch {
    return new Map();
  }
}

function persistDrafts() {
  try {
    const saved = Object.fromEntries(drafts);
    if (saved.delivery?.mission?.destination?.kind === "device") {
      saved.delivery = { ...saved.delivery, mission: { ...saved.delivery.mission, destination: null } };
    }
    sessionStorage.setItem(draftKey, JSON.stringify(saved));
  } catch {
    // Drafts remain available until the page closes if tab storage is disabled.
  }
}

function sameLocation(first, second) {
  return first && second && first.lat === second.lat && first.lon === second.lon;
}

function openPlan(type, place) {
  if (type === "delivery") {
    foodOrder.open(startingPoint, drafts.get(type)?.mission);
    return;
  }
  selectedPlan = type;
  const plan = planTypes[type];
  document.querySelector("#dialog-title").textContent = plan.title;
  document.querySelector("#detail-label").textContent = plan.label;
  planInput.placeholder = plan.placeholder;
  const draft = drafts.get(type);
  selectedDestination = place ?? draft?.place ?? null;
  planInput.value = place?.name ?? draft?.detail ?? "";
  resetTripSimulation();
  planInput.setCustomValidity("");
  tripSearch.setEnabled(type === "trip");
  document.querySelector("#trip-search").hidden = type !== "trip";
  document.querySelector("#distance-note").textContent = startingPoint
    ? "Distances are straight-line estimates." : "Set a starting point to see distances.";
  document.querySelector("#destination-status").textContent = selectedDestination?.address ?? "";
  dialog.showModal();
}

function planButton(type) {
  return document.querySelector(`[data-plan="${type}"]`);
}

function renderDrafts() {
  draftSection.hidden = drafts.size === 0;
  draftList.replaceChildren();
  for (const [type, draft] of drafts) {
    const row = document.createElement("li");
    row.className = "draft";
    const description = document.createElement("span");
    description.textContent = `${planTypes[type].summary}: ${draft.detail}`;
    const descriptionDetail = draft.mission
      ? draft.mission.origin.address + " · " + draft.mission.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")
      : draft.place?.address;
    if (descriptionDetail) {
      const address = document.createElement("small");
      address.textContent = descriptionDetail;
      description.append(address);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = draft.preview ? "Open" : "Edit";
    edit.setAttribute("aria-label", `${edit.textContent} ${planTypes[type].summary.toLowerCase()}`);
    edit.addEventListener("click", () => {
      if (draft.preview) {
        const point = type === "trip" ? draft.preview.origin : draft.mission.destination;
        if (point) restoreRouteDraft(type, draft, point);
        else askForLocation(type, draft);
        return;
      }
      cancelDraftRestore();
      if (draft.mission?.destination) foodOrder.open(draft.mission.destination, draft.mission);
      else if (startingPoint) {
        updateMap(startingPoint);
        openPlan(type);
      } else askForLocation(type);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${planTypes[type].summary.toLowerCase()}`);
    remove.addEventListener("click", () => {
      cancelDraftRestore();
      drafts.delete(type);
      persistDrafts();
      renderDrafts();
      planButton(type).focus();
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
dialog.addEventListener("close", () => {
  tripSearch.reset();
  resetTripSimulation();
});

function resetTripSimulation() {
  tripRequest?.abort();
  tripRequest = undefined;
  simulateTrip.disabled = !startingPoint || !selectedDestination;
  tripProgress.textContent = simulateTrip.disabled ? "Choose a destination suggestion to simulate a route." : "";
}

simulateTrip.addEventListener("click", async () => {
  if (simulateTrip.disabled || !startingPoint || !selectedDestination) return;
  const mission = { mode: "trip", origin: startingPoint, destination: selectedDestination };
  const controller = new AbortController();
  tripRequest = controller;
  simulateTrip.disabled = true;
  tripProgress.textContent = "Simulating trip route…";
  try {
    const result = await simulateMission(mission, controller.signal);
    if (controller.signal.aborted || !dialog.open) return;
    dialog.close();
    showRoute(mission, result);
  } catch (error) {
    if (!controller.signal.aborted) tripProgress.textContent = error.message;
  } finally {
    if (tripRequest === controller) {
      tripRequest = undefined;
      simulateTrip.disabled = false;
    }
  }
});
planInput.addEventListener("input", () => planInput.setCustomValidity(""));

document.querySelector("#plan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const detail = planInput.value.trim();
  if (!detail) {
    planInput.setCustomValidity("Fill in this field to save a draft.");
    planInput.reportValidity();
    return;
  }
  const previous = drafts.get(selectedPlan);
  const preview = sameLocation(previous?.place, selectedDestination) &&
    (sameLocation(previous.preview?.origin, startingPoint) || startingPoint?.kind === "device" && previous.preview?.origin === null)
    ? previous.preview : null;
  const draft = { detail, place: selectedDestination, preview };
  drafts.set(selectedPlan, draft);
  persistDrafts();
  renderDrafts();
  dialog.close();
  planButton(selectedPlan).focus();
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
const routeSummary = document.querySelector("#route-summary");
const home = document.querySelector(".home");
const routeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const findDetour = document.querySelector("#find-detour");
const detourStatus = document.querySelector("#detour-status");
const routeChoice = document.querySelector("#route-choice");
const routeChoiceLabel = document.querySelector("#route-choice-label");
const briefingButton = document.querySelector("#request-briefing");
const briefingText = document.querySelector("#briefing-text");
const approveRoute = document.querySelector("#approve-route");
const holdRoute = document.querySelector("#hold-route");
const reviewStatus = document.querySelector("#review-status");
const saveRouteDraft = document.querySelector("#save-route-draft");
const saveRouteStatus = document.querySelector("#save-route-status");
const reviews = new Map();
const briefings = new Map();
let selectedRoute;
let briefingRequest;
let routeMission;
let directRoute;
let alternateRoute;
let detourRequest;

function cancelDraftRestore() {
  draftRequest?.abort();
  draftRequest = undefined;
  draftStatus.textContent = "";
}

async function restoreRouteDraft(type, draft, point) {
  if (draftRequest) return;
  const controller = new AbortController();
  draftRequest = controller;
  draftStatus.textContent = "Checking your saved route…";
  const mission = type === "trip"
    ? { mode: "trip", origin: point, destination: draft.place }
    : { ...draft.mission, destination: point };
  try {
    const result = await simulateMission(mission, controller.signal);
    let detour;
    let notice;
    if (draft.preview.candidate === "detour") {
      if (result.status === "blocked") {
        detour = await simulateMission(mission, controller.signal, { detour: true });
        if (!detour) notice = "The saved detour is unavailable in the current check. The direct route is shown for review.";
      } else notice = "The direct route now passes the FAA snapshot check. The saved detour is no longer needed.";
    }
    if (controller.signal.aborted) return;
    startingPoint = point;
    locationButton.textContent = point.name;
    showRoute(mission, result, { detour, notice });
  } catch {
    if (!controller.signal.aborted) draftStatus.textContent = "Couldn’t reopen the route. Your draft is still saved. Try again.";
  } finally {
    if (draftRequest === controller) draftRequest = undefined;
  }
}

function showRoute(mission, result, { detour, notice = "" } = {}) {
  cancelDraftRestore();
  detourRequest?.abort();
  detourRequest = undefined;
  routeMission = mission;
  reviews.clear();
  briefings.clear();
  directRoute = result;
  alternateRoute = undefined;
  findDetour.hidden = result.status !== "blocked";
  findDetour.disabled = false;
  detourStatus.textContent = notice;
  routeChoiceLabel.hidden = true;
  routeChoice.value = "direct";
  saveRouteDraft.textContent = mission.mode === "trip" ? "Save trip draft" : "Save order draft";
  if (detour) selectDetour(detour);
  else renderRoute(mission, result);
  routeSummary.scrollTop = 0;
  document.querySelector("#route-title").focus();
}

function renderRoute(mission, result) {
  const trip = mission.mode === "trip";
  const labels = trip ? ["Start", "Destination"] : ["Pickup", "Drop-off"];
  const blocked = result.status === "blocked";
  home.dataset.routeView = "";
  locationButton.hidden = true;
  routeSummary.hidden = false;
  routeSummary.dataset.status = result.status;
  document.querySelector("#route-title").textContent = trip ? "Trip simulation" : "Delivery simulation";
  document.querySelector("#back-to-order").textContent = trip ? "← Back to trip" : "← Back to order";
  document.querySelector("#route-origin-label").textContent = labels[0];
  document.querySelector("#route-destination-label").textContent = labels[1];
  document.querySelector("#route-status").textContent = blocked
    ? "FAA airspace overlap — review required" : "No overlap with listed FAA areas";
  document.querySelector("#route-pickup").textContent = [mission.origin.name, mission.origin.address].filter(Boolean).join(" · ");
  document.querySelector("#route-dropoff").textContent = mission.destination.name;
  document.querySelector("#route-distance").textContent = routeFormat.format(result.distance_miles) + " mi";
  document.querySelector("#route-eta-row").hidden = result.eta_minutes === null;
  document.querySelector("#route-eta").textContent = result.eta_minutes === null
    ? "" : routeFormat.format(result.eta_minutes) + " min";
  document.querySelector("#route-assumptions").textContent = result.eta_minutes === null
    ? "Flight time is unavailable for this blocked candidate."
    : "Assumes " + routeFormat.format(result.assumed_speed_mph) + " mph. Excludes takeoff and landing." + (trip ? "" : " Loading time is excluded.");
  const finding = document.querySelector("#route-finding");
  const zoneNames = result.restrictions.filter((zone) => result.findings.some((item) => item.zone_id === zone.id))
    .map((zone) => zone.name + ([zone.lower, zone.upper].some(Boolean) ? " (" + [zone.lower, zone.upper].filter(Boolean).join("–") + ")" : ""));
  const snapshot = new Date(result.airspace_retrieved_at);
  document.querySelector("#route-source-date").textContent = Number.isNaN(snapshot.getTime()) ? "" :
    " · Retrieved " + new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeZone: "UTC"}).format(snapshot);
  finding.hidden = !zoneNames.length;
  finding.textContent = zoneNames.length ? "The dashed segment crosses published airspace for " + zoneNames.join(", ") + "." : "";
  document.querySelector("#route-line-label").textContent = blocked ? "Segment for review" :
    result === alternateRoute ? "Selected detour" : "Candidate route";
  document.querySelector("#route-zone-key").hidden = !result.restrictions.length;
  updateMap(mission.origin, mission.destination, result, labels);
  briefingRequest?.abort();
  briefingRequest = undefined;
  selectedRoute = result;
  saveRouteStatus.textContent = "";
  briefingText.textContent = briefings.get(result) ?? "";
  briefingButton.hidden = briefings.has(result);
  briefingButton.disabled = false;
  renderReview();
}

saveRouteDraft.addEventListener("click", () => {
  if (!routeMission || !selectedRoute) return;
  const { mode, origin, destination } = routeMission;
  const candidate = selectedRoute === alternateRoute ? "detour" : "direct";
  if (mode === "trip") {
    drafts.set(mode, {
      detail: destination.name,
      place: destination,
      preview: { candidate, origin: origin.kind === "device" ? null : origin },
    });
  } else {
    drafts.set(mode, { detail: origin.name, mission: routeMission, preview: { candidate } });
  }
  persistDrafts();
  renderDrafts();
  const label = mode === "trip" ? "Trip draft" : "Order draft";
  saveRouteStatus.textContent = label + " saved with the " + (candidate === "detour" ? "detour." : "direct route.");
});

function renderReview() {
  const blocked = selectedRoute.status === "blocked";
  const decision = reviews.get(selectedRoute);
  approveRoute.disabled = blocked;
  approveRoute.setAttribute("aria-pressed", String(decision === "approved"));
  holdRoute.setAttribute("aria-pressed", String(decision === "held"));
  reviewStatus.textContent = decision === "approved" ? "Approved for this simulation." :
    decision === "held" ? "On hold for this simulation." :
    blocked ? "Only Hold is available because this route overlaps listed FAA airspace." :
    "Awaiting your decision.";
}

approveRoute.addEventListener("click", () => {
  if (selectedRoute?.status !== "no_listed_overlap") return;
  reviews.set(selectedRoute, "approved");
  renderReview();
});
holdRoute.addEventListener("click", () => {
  if (!selectedRoute) return;
  reviews.set(selectedRoute, "held");
  renderReview();
});

briefingButton.addEventListener("click", async () => {
  if (!selectedRoute || briefingRequest) return;
  const route = selectedRoute;
  const controller = new AbortController();
  briefingRequest = controller;
  briefingButton.disabled = true;
  briefingText.textContent = "Generating the explanation…";
  const { origin, destination } = routeMission;
  const coordinates = ({ lat, lon }) => ({ lat, lon });
  try {
    const response = await fetch("/api/route-briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: coordinates(origin), destination: coordinates(destination), confirmed: true,
        candidate: route === alternateRoute ? "detour" : "direct",
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(23000)]),
    });
    if (!response.ok) throw new Error("Briefing unavailable");
    const { explanation } = await response.json();
    if (typeof explanation !== "string" || !explanation.trim()) throw new Error("Briefing missing");
    if (controller.signal.aborted) return;
    briefings.set(route, explanation);
    briefingText.textContent = explanation;
    briefingButton.hidden = true;
  } catch {
    if (!controller.signal.aborted) {
      briefingText.textContent = "The AI briefing is unavailable. You can still use the route results and record a decision.";
    }
  } finally {
    if (briefingRequest === controller) {
      briefingRequest = undefined;
      briefingButton.disabled = false;
    }
  }
});

function selectDetour(result) {
  alternateRoute = result;
  routeChoice.options[1].textContent = "Shortest detour found · " + routeFormat.format(result.eta_minutes) + " min";
  routeChoiceLabel.hidden = false;
  routeChoice.value = "detour";
  findDetour.hidden = true;
  renderRoute(routeMission, result);
}

findDetour.addEventListener("click", async () => {
  if (findDetour.disabled || !routeMission) return;
  const controller = new AbortController();
  detourRequest = controller;
  findDetour.disabled = true;
  detourStatus.textContent = "Searching for a detour…";
  try {
    const result = await simulateMission(routeMission, controller.signal, { detour: true });
    if (controller.signal.aborted) return;
    if (!result) {
      detourStatus.textContent = "No detour found within the search area. Try a different start or destination.";
      return;
    }
    selectDetour(result);
    routeChoice.focus();
    detourStatus.textContent = "Detour shown on the map.";
  } catch (error) {
    if (!controller.signal.aborted) detourStatus.textContent = error.message;
  } finally {
    if (detourRequest === controller) {
      detourRequest = undefined;
      findDetour.disabled = false;
    }
  }
});
routeChoice.addEventListener("change", () => {
  renderRoute(routeMission, routeChoice.value === "detour" ? alternateRoute : directRoute);
  detourStatus.textContent = "";
});

const foodOrder = createFoodOrder({
  onRoute: showRoute,
  onSave(mission) {
    const previous = drafts.get("delivery");
    const sameDropoff = previous?.mission?.destination === null ||
      sameLocation(previous?.mission?.destination, mission.destination);
    const preview = sameLocation(previous?.mission?.origin, mission.origin) && sameDropoff ? previous.preview : null;
    drafts.set("delivery", { detail: mission.origin.name, mission, preview });
    persistDrafts();
    renderDrafts();
    updateMap(mission.origin, mission.destination);
  },
});
document.querySelector("#back-to-order").addEventListener("click", () => {
  const mission = routeMission;
  detourRequest?.abort();
  detourRequest = undefined;
  briefingRequest?.abort();
  briefingRequest = undefined;
  selectedRoute = undefined;
  routeMission = undefined;
  routeSummary.hidden = true;
  delete home.dataset.routeView;
  locationButton.hidden = false;
  if (mission.mode === "trip") {
    startingPoint = mission.origin;
    updateMap(mission.origin);
    openPlan("trip", mission.destination);
  } else {
    updateMap(mission.origin, mission.destination);
    foodOrder.open(mission.destination, mission);
  }
});
let locationAttempt = 0;
let pendingPlan = null;
let pendingRouteDraft = null;
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
  const routeDraft = pendingRouteDraft;
  pendingPlan = null;
  pendingRouteDraft = null;
  if (routeDraft) restoreRouteDraft(plan, routeDraft, point);
  else if (plan) openPlan(plan);
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

function askForLocation(type = null, routeDraft = null) {
  cancelDraftRestore();
  pendingPlan = type;
  pendingRouteDraft = routeDraft;
  originInput.value = "";
  originSearch.reset();
  setLocationBusy(false);
  document.querySelector("#location-title").textContent = type === "delivery" ? "Where should we deliver?" : "Where are you starting?";
  document.querySelector("#location-instructions").textContent = type === "delivery"
    ? "Choose a drop-off point in Florida." : "Choose a starting point in Florida.";
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
      setStartingPoint({ name: "Current location", lat: coords.latitude, lon: coords.longitude, kind: "device" });
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
coverageDialog.addEventListener("close", () => askForLocation(pendingPlan, pendingRouteDraft));
locationDialog.addEventListener("close", () => {
  cancelDeviceWatch();
  locationAttempt++;
  setLocationBusy(false);
  originSearch.reset();
});
