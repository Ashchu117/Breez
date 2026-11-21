const PHOTON_URL = "https://photon.komoot.io/api/";
const FLORIDA_BIAS = { lat: "28.15", lon: "-81.85" };
const localPlaces = [
  // Addresses from lovebirdeats.com. Winter Haven is geocoded by the US Census Bureau.
  { name: "LoveBird Almost Famous Chicken", address: "2101 South Florida Avenue, Lakeland, FL", lat: 28.0183316, lon: -81.9573739 },
  { name: "LoveBird Almost Famous Chicken", address: "199 6th Street NW, Winter Haven, FL", lat: 28.0238877, lon: -81.7330421 },
];
const cache = new Map();

function normalized(value) {
  return value.normalize("NFD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function isPlace(place) {
  return typeof place?.name === "string" && place.name.length > 0
    && typeof place.address === "string"
    && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90
    && Number.isFinite(place.lon) && Math.abs(place.lon) <= 180;
}

function distanceMiles(from, to) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const a = Math.sin(rad(to.lat - from.lat) / 2) ** 2
    + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lon - from.lon) / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function distanceLabel(from, to) {
  const miles = distanceMiles(from, to);
  if (miles < 0.1) return "<0.1 mi";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: miles < 10 ? 1 : 0 }).format(miles) + " mi";
}

function readPlace(feature) {
  const props = feature.properties ?? {};
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  const street = [props.housenumber, props.street].filter(Boolean).join(" ");
  const name = props.name || street || props.city || props.district;
  const area = [props.city || props.district || props.county, props.state, props.countrycode === "US" ? "" : props.country];
  const address = [...new Set([street, ...area].filter((value) => value && value !== name))].join(", ");
  return { name, address, lat, lon };
}

function sameLocation(first, second) {
  if (normalized(first.name) !== normalized(second.name)) return false;
  return distanceMiles(first, second) < 0.01;
}

function mergePlaces(primary, remote) {
  const places = [];
  for (const place of [...primary, ...remote]) {
    if (!places.some((existing) => sameLocation(existing, place))) places.push(place);
  }
  return places.slice(0, 8);
}

async function searchPlaces(query, signal) {
  const key = normalized(query);
  const known = localPlaces.filter((place) => normalized(place.name).startsWith(key));
  if (cache.has(key)) return { places: cache.get(key), partial: false };

  try {
    const url = new URL(PHOTON_URL);
    url.search = new URLSearchParams({ q: query, limit: "10", ...FLORIDA_BIAS });
    const response = await fetch(url, {
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error("Place search unavailable");
    const payload = await response.json();
    const places = mergePlaces(known, payload.features.map(readPlace).filter(isPlace));
    if (cache.size >= 40) cache.delete(cache.keys().next().value);
    cache.set(key, places);
    return { places, partial: false };
  } catch (error) {
    if (signal.aborted) throw error;
    return { places: known, partial: true };
  }
}

export function createPlaceSearch({ input, list, status, getOrigin = () => null, onSelect, onType = () => {} }) {
  let matches = [];
  let active = -1;
  let timer;
  let request;
  let enabled = true;

  function clearResults() {
    matches = [];
    active = -1;
    list.replaceChildren();
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function reset() {
    clearTimeout(timer);
    request?.abort();
    clearResults();
    status.textContent = "";
  }

  function choose(index) {
    const place = matches[index];
    reset();
    input.value = place.name;
    onSelect(place);
    status.textContent = [place.address, getOrigin() && distanceLabel(getOrigin(), place)].filter(Boolean).join(" · ");
    input.focus();
  }

  function showResults(places) {
    matches = places;
    const origin = getOrigin();
    for (const [index, place] of places.entries()) {
      const option = document.createElement("li");
      option.id = list.id + "-" + index;
      option.role = "option";
      option.setAttribute("aria-selected", "false");
      const details = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = place.name;
      details.append(name);
      if (place.address) {
        const address = document.createElement("small");
        address.textContent = place.address;
        details.append(address);
      }
      option.append(details);
      if (origin) {
        const distance = document.createElement("span");
        distance.className = "place-distance";
        distance.textContent = distanceLabel(origin, place);
        option.append(distance);
      }
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(index));
      list.append(option);
    }
    list.hidden = places.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
  }

  input.addEventListener("input", () => {
    if (!enabled) return;
    reset();
    onType();
    const query = input.value.trim();
    if (normalized(query).length < 3) return;

    const controller = new AbortController();
    request = controller;
    timer = setTimeout(async () => {
      status.textContent = "Searching places…";
      try {
        const { places, partial } = await searchPlaces(query, controller.signal);
        if (controller.signal.aborted) return;
        showResults(places);
        if (partial) {
          status.textContent = places.length ? "Showing verified local results." : "Place search unavailable. Try again shortly.";
        } else {
          status.textContent = places.length ? places.length + " suggestions" : "No matching places.";
        }
      } catch {
        // A newer query or a closed dialog has replaced this request.
      }
    }, 325);
  });

  input.addEventListener("keydown", (event) => {
    if (list.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      reset();
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list.children[active]?.setAttribute("aria-selected", "false");
      active = active < 0 && step < 0 ? matches.length - 1 : (active + step + matches.length) % matches.length;
      const option = list.children[active];
      option.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });

  function setEnabled(value) {
    reset();
    enabled = value;
    for (const [attribute, content] of Object.entries({
      role: "combobox", "aria-autocomplete": "list", "aria-controls": list.id, "aria-expanded": "false",
    })) {
      if (value) input.setAttribute(attribute, content);
      else input.removeAttribute(attribute);
    }
  }

  setEnabled(true);
  return { reset, setEnabled };
}
