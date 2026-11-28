import { floridaPoly, regionalPoint } from "./geography.js?v=1";
import { installRouteOverlay, routeExtent } from "./delivery-map.js?v=2";

const title = document.querySelector("#traffic-area");
const trafficStatus = document.querySelector("#traffic-status");
const trafficPanel = document.querySelector(".traffic-info");
const recenter = document.querySelector("#recenter-map");
const mouseGuide = document.querySelector("#map-mouse-guide");
const retryTraffic = document.querySelector("#retry-traffic");
const MAX_SNAPSHOT_AGE = 15 * 60 * 1000;
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function viewAt({ lat, lon }) {
  return { center: [lon, lat], zoom: 8.5, bearing: 0, pitch: 0 };
}

export function startMap() {
  if (!window.maplibregl) {
    trafficStatus.textContent = "Map unavailable";
    return () => {};
  }

  let map;
  try {
    map = new maplibregl.Map({
      container: "traffic-map",
      style: "https://tiles.openfreemap.org/styles/dark",
      ...viewAt(floridaPoly),
      minZoom: 5,
      maxZoom: 15,
      attributionControl: false,
      scrollZoom: true,
    });
  } catch {
    trafficStatus.textContent = "Map unavailable";
    return () => {};
  }

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  let center = floridaPoly;
  let markers = [];
  let lastSnapshot;
  let deliveryMarkers = [];
  let deliveryBounds;
  let deliveryRoute;
  let drawRoute;
  let pending;
  let ready = false;

  function moveToArea() {
    if (deliveryBounds) {
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      const padding = mobile ? { top: 88, right: 52, bottom: 112, left: 52 } : 110;
      map.fitBounds(deliveryBounds, {
        padding: deliveryRoute ? { top: 110, right: 55, bottom: 110, left: 55 } : padding,
        maxZoom: deliveryRoute ? 13 : 10,
      });
    } else map.easeTo(viewAt(center));
  }

  function markStops(origin, destination, labels) {
    for (const marker of deliveryMarkers) marker.remove();
    deliveryMarkers = [];
    deliveryBounds = undefined;
    if (!destination) return;

    deliveryBounds = new maplibregl.LngLatBounds();
    for (const [label, point] of [[labels[0], origin], [labels[1], destination]]) {
      const coords = [point.lon, point.lat];
      const marker = document.createElement("span");
      marker.className = "delivery-stop";
      marker.textContent = label;
      marker.title = point.name;
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-label", label + ": " + point.name);
      deliveryMarkers.push(new maplibregl.Marker({ element: marker }).setLngLat(coords).addTo(map));
      deliveryBounds.extend(coords);
    }
  }

  function clearMarkers() {
    for (const marker of markers) marker.remove();
    markers = [];
    delete trafficPanel.dataset.available;
    delete trafficPanel.dataset.delayed;
  }

  function isRecent(snapshot) {
    return Number.isFinite(snapshot?.observed_at) && Date.now() - snapshot.observed_at <= MAX_SNAPSHOT_AGE;
  }

  function showTrafficStatus(snapshot, delayed) {
    trafficPanel.toggleAttribute("data-available", !delayed);
    trafficPanel.toggleAttribute("data-delayed", delayed);
    for (const marker of markers) marker.getElement().toggleAttribute("data-delayed", delayed);
    const time = timeFormatter.format(snapshot.observed_at);
    trafficStatus.textContent = delayed ? "Aircraft feed delayed · last update " + time :
      markers.length + " aircraft in region · updated " + time;
    retryTraffic.hidden = !delayed;
  }

  async function refreshTraffic() {
    if (pending || document.hidden) return;

    const controller = new AbortController();
    pending = controller;
    retryTraffic.disabled = true;
    if (lastSnapshot && !isRecent(lastSnapshot)) {
      clearMarkers();
      lastSnapshot = undefined;
      trafficStatus.textContent = "Refreshing aircraft positions…";
    }
    const { lat, lon } = regionalPoint(center);
    const params = new URLSearchParams({ lat, lon });
    try {
      const response = await fetch("/api/air-traffic?" + params, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8500)]),
      });
      if (!response.ok) throw new Error("Aircraft feed unavailable");
      const snapshot = await response.json();
      if (controller.signal.aborted) return;
      // During a rolling deploy, keep the legacy regional feed on the default map only.
      const matchesRegion = snapshot.region?.lat === lat && snapshot.region?.lon === lon;
      if (!matchesRegion && (snapshot.region || center !== floridaPoly)) {
        throw new Error("Aircraft feed is for another region");
      }
      if (!isRecent(snapshot)) {
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
      lastSnapshot = snapshot;
      showTrafficStatus(snapshot, snapshot.delayed === true);
    } catch {
      if (controller.signal.aborted) return;
      if (isRecent(lastSnapshot)) showTrafficStatus(lastSnapshot, true);
      else {
        lastSnapshot = undefined;
        clearMarkers();
        trafficStatus.textContent = "Aircraft feed unavailable · map and routes still work";
        retryTraffic.hidden = false;
      }
    } finally {
      if (pending === controller) {
        pending = undefined;
        retryTraffic.disabled = false;
      }
    }
  }

  map.on("error", () => {
    if (!ready) trafficStatus.textContent = "Map unavailable";
  });
  map.once("load", () => {
    ready = true;
    drawRoute = installRouteOverlay(map);
    drawRoute(deliveryRoute);
    recenter.hidden = false;
    mouseGuide.hidden = false;
    recenter.addEventListener("click", moveToArea);
    retryTraffic.addEventListener("click", refreshTraffic);
    refreshTraffic();
    window.setInterval(refreshTraffic, 60_000);
    document.addEventListener("visibilitychange", refreshTraffic);
  });

  return (point, destination, result, labels = ["Pickup", "Drop-off"]) => {
    deliveryRoute = result;
    map.resize();
    const previousRegion = regionalPoint(center);
    const nextRegion = regionalPoint(point);
    center = point;
    title.textContent = point.area ? point.area + " air traffic" : "Air traffic near your start";
    map.getContainer().setAttribute("aria-label", result ? "Simulated route map" : title.textContent + " map");
    recenter.textContent = result ? "Fit route" : "Recenter map";
    markStops(point, destination, labels);
    if (result) for (const coords of routeExtent(result)) deliveryBounds.extend(coords);
    drawRoute?.(result);
    moveToArea();
    if (previousRegion.lat !== nextRegion.lat || previousRegion.lon !== nextRegion.lon) {
      pending?.abort();
      pending = undefined;
      lastSnapshot = undefined;
      clearMarkers();
      retryTraffic.hidden = true;
      if (ready) {
        trafficStatus.textContent = "Loading aircraft for this area…";
        refreshTraffic();
      }
    }
  };
}
