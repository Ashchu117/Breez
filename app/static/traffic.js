import { floridaPoly, regionalPoint } from "./geography.js?v=1";
import { installRouteOverlay, routeExtent } from "./delivery-map.js?v=1";

const title = document.querySelector("#traffic-area");
const trafficStatus = document.querySelector("#traffic-status");
const trafficPanel = document.querySelector(".traffic-info");
const recenter = document.querySelector("#recenter-map");
const MAX_SNAPSHOT_AGE = 6 * 60 * 1000;
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
      scrollZoom: false,
    });
  } catch {
    trafficStatus.textContent = "Map unavailable";
    return () => {};
  }

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  let center = floridaPoly;
  let markers = [];
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

  function markDeliveryStops(origin, destination) {
    for (const marker of deliveryMarkers) marker.remove();
    deliveryMarkers = [];
    deliveryBounds = undefined;
    if (!destination) return;

    deliveryBounds = new maplibregl.LngLatBounds();
    for (const [label, point] of [["Pickup", origin], ["Drop-off", destination]]) {
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
  }

  async function refreshTraffic() {
    if (pending || document.hidden) return;

    const controller = new AbortController();
    pending = controller;
    const { lat, lon } = regionalPoint(center);
    const params = new URLSearchParams({ lat, lon });
    try {
      const response = await fetch("/api/air-traffic?" + params, {
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
      trafficStatus.textContent = markers.length + " aircraft in region · " + timeFormatter.format(snapshot.observed_at);
    } catch {
      if (!controller.signal.aborted) {
        clearMarkers();
        trafficStatus.textContent = "Aircraft data unavailable for this area";
      }
    } finally {
      if (pending === controller) pending = undefined;
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
    recenter.addEventListener("click", moveToArea);
    refreshTraffic();
    window.setInterval(refreshTraffic, 60_000);
    document.addEventListener("visibilitychange", refreshTraffic);
  });

  return (point, deliveryDestination, result) => {
    deliveryRoute = result;
    map.resize();
    center = point;
    title.textContent = point.area ? point.area + " air traffic" : "Air traffic near your start";
    map.getContainer().setAttribute("aria-label", result ? "Simulated delivery route map" : title.textContent + " map");
    recenter.textContent = result ? "Fit delivery route" : "Recenter map";
    markDeliveryStops(point, deliveryDestination);
    if (result) for (const coords of routeExtent(result)) deliveryBounds.extend(coords);
    drawRoute?.(result);
    moveToArea();
    pending?.abort();
    pending = undefined;
    clearMarkers();
    trafficStatus.textContent = "Loading aircraft for this area…";
    if (ready) refreshTraffic();
  };
}
