const sourceId = "delivery-simulation";
const routeColor = "#78ead5";
const warningColor = "#ffad83";

function coordinate({ lat, lon }) {
  return [lon, lat];
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
    ...result.restrictions.map((zone) => feature("MultiPolygon", zone.polygons, "zone")),
    ...segments,
  ];
}

export function routeExtent(result) {
  return result.points.map(coordinate);
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
