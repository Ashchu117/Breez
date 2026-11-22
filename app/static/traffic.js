import { floridaPoly, regionalPoint } from "./geography.js?v=1";

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
  let pending;
  let ready = false;

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
    recenter.hidden = false;
    recenter.addEventListener("click", () => map.easeTo(viewAt(center)));
    refreshTraffic();
    window.setInterval(refreshTraffic, 60_000);
    document.addEventListener("visibilitychange", refreshTraffic);
  });

  return (point) => {
    center = point;
    title.textContent = point.area ? point.area + " air traffic" : "Air traffic near your start";
    map.getContainer().setAttribute("aria-label", title.textContent + " map");
    map.easeTo(viewAt(center));
    pending?.abort();
    pending = undefined;
    clearMarkers();
    trafficStatus.textContent = "Loading aircraft for this area…";
    if (ready) refreshTraffic();
  };
}
