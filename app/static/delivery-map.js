const sourceId = "delivery-simulation";
const routeColor = "#78ead5";
const warningColor = "#ffad83";
const milesPerDegree = 3958.76 * Math.PI / 180;

function coordinate({ lat, lon }) {
  return [lon, lat];
}

function zoneRing(zone) {
  const { lat, lon } = zone.center;
  const latRadius = zone.radius_miles / milesPerDegree;
  const lonRadius = latRadius / Math.cos(lat * Math.PI / 180);
  const ring = Array.from({ length: 48 }, (_, index) => {
    const angle = index * Math.PI / 24;
    return [lon + Math.cos(angle) * lonRadius, lat + Math.sin(angle) * latRadius];
  });
  return [...ring, ring[0]];
}

function feature(type, coordinates, kind) {
  return { type: "Feature", geometry: { type, coordinates }, properties: { kind } };
}

function routeFeatures(result) {
  if (!result) return [];
  const blocked = new Set(result.findings.map((finding) => finding.segment_index));
  const segments = result.points.slice(1).map((end, index) => feature(
    "LineString", [coordinate(result.points[index]), coordinate(end)], blocked.has(index) ? "blocked" : "route",
  ));
  return [
    ...result.restrictions.map((zone) => feature("Polygon", [zoneRing(zone)], "zone")),
    ...segments,
  ];
}

export function routeExtent(result) {
  const blockedZones = new Set(result.findings.map((finding) => finding.zone_id));
  return [
    ...result.points.map(coordinate),
    ...result.restrictions.filter((zone) => blockedZones.has(zone.id)).flatMap(zoneRing),
  ];
}

export function installRouteOverlay(map) {
  map.addSource(sourceId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const zoneFilter = ["==", ["get", "kind"], "zone"];
  const lineLayout = { "line-cap": "round", "line-join": "round" };
  for (const layer of [
    { id: "delivery-zone-fill", type: "fill", filter: zoneFilter,
      paint: { "fill-color": warningColor, "fill-opacity": 0.2 } },
    { id: "delivery-zone-border", type: "line", filter: zoneFilter,
      paint: { "line-color": warningColor, "line-width": 2, "line-dasharray": [2, 2] } },
    { id: "delivery-line-outline", type: "line", filter: ["!=", ["get", "kind"], "zone"], layout: lineLayout,
      paint: { "line-color": "#17231d", "line-width": 10 } },
    { id: "delivery-line", type: "line", filter: ["==", ["get", "kind"], "route"], layout: lineLayout,
      paint: { "line-color": routeColor, "line-width": 5 } },
    { id: "delivery-blocked-line", type: "line", filter: ["==", ["get", "kind"], "blocked"], layout: lineLayout,
      paint: { "line-color": warningColor, "line-width": 5, "line-dasharray": [2, 2] } },
  ]) map.addLayer({ source: sourceId, ...layer });

  return (result) => map.getSource(sourceId).setData({
    type: "FeatureCollection",
    features: routeFeatures(result),
  });
}
