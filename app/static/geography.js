export const floridaPoly = {
  name: "Florida Polytechnic University",
  area: "Lakeland",
  lat: 28.1477054,
  lon: -81.8487852,
};

export const floridaBounds = [-87.7, 24.3, -79.8, 31.1];

export function regionalPoint({ lat, lon }) {
  return { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2 };
}

let boundary;

function loadBoundary() {
  boundary ??= fetch("/static/florida-boundary.json?v=1")
    .then((response) => {
      if (!response.ok) throw new Error("Florida boundary unavailable");
      return response.json();
    })
    .catch((error) => {
      boundary = undefined;
      throw error;
    });
  return boundary;
}

function insideRing({ lat, lon }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [prevX, prevY] = ring[previous];
    if ((y > lat) !== (prevY > lat) && lon < ((prevX - x) * (lat - y)) / (prevY - y) + x) {
      inside = !inside;
    }
  }
  return inside;
}

export async function isInFlorida(point) {
  const [west, south, east, north] = floridaBounds;
  if (point.lon < west || point.lon > east || point.lat < south || point.lat > north) return false;

  const { coordinates } = await loadBoundary();
  return coordinates.some(([outer, ...holes]) =>
    insideRing(point, outer) && !holes.some((hole) => insideRing(point, hole))
  );
}
