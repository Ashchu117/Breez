import { floridaBounds, floridaPoly, isInFlorida, regionalPoint } from "./geography.js?v=1";

const PHOTON_URL = "https://photon.komoot.io/api/";
const NUMBERED_ADDRESS = /^(\d+[a-z]?(?:-\d+)?)\s+(.+)$/i;
const ROAD_ENDING = /\b(?:alley|aly|avenue|ave|boulevard|blvd|causeway|cswy|circle|cir|court|ct|drive|dr|highway|hwy|lane|ln|parkway|pkwy|place|pl|road|rd|street|st|terrace|ter|trail|trl|way|walk|loop|pike)\b|\b(?:us|sr|cr)\s*[- ]?\d+/i;
const localPlaces = [
  // Addresses from lovebirdeats.com. Winter Haven is geocoded by the US Census Bureau.
  { name: "LoveBird Almost Famous Chicken", address: "2101 South Florida Avenue, Lakeland, FL", lat: 28.0183316, lon: -81.9573739 },
  { name: "LoveBird Almost Famous Chicken", address: "199 6th Street NW, Winter Haven, FL", lat: 28.0238877, lon: -81.7330421 },
];
const deerfieldStreet = {
  name: "Little Harbor Way (NE 11th Way)", address: "Deerfield Beach, FL",
  area: "Deerfield Beach", lat: 26.320687, lon: -80.0893207, kind: "street",
};
const deerfieldPattern = /^(?:little harbor way|(?:ne|northeast|north east) 11th way)(?=$|[ ,])(?:[\s,]+(?:deerfield beach|florida|fl|33441))*$/i;
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

function readPlace(feature, houseNumber) {
  const props = feature.properties ?? {};
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  const number = String(props.housenumber ?? "");
  const street = [number, props.street].filter(Boolean).join(" ");
  const placeName = houseNumber ? street : props.name || street || props.city || props.district;
  const name = houseNumber && number.toLowerCase() !== houseNumber.toLowerCase() ? null : placeName;
  const area = props.city || props.town || props.district || props.county;
  const address = [...new Set([street, area, props.state].filter((value) => value && value !== name))].join(", ");
  return {
    name, address, lat, lon, area: area || name,
    houseNumber: number, street: props.street,
    kind: number ? "address" : props.osm_key === "highway" ? "street" : undefined,
  };
}

function isDeerfieldStreet(place) {
  return normalized(place.area ?? "") === "deerfieldbeach"
    && /^(?:littleharborway|(?:ne|northeast)11thway)$/.test(normalized(place.street || place.name));
}

function addressKey(place) {
  return [place.houseNumber, place.street, place.area].map((value) => normalized(value ?? "")).join(":");
}

function sameLocation(first, second) {
  if (first.houseNumber && second.houseNumber) {
    if (first.houseNumber.toLowerCase() !== second.houseNumber.toLowerCase()) return false;
    if (isDeerfieldStreet(first) && isDeerfieldStreet(second)) return true;
    if (first.street && first.area && addressKey(first) === addressKey(second)) return true;
  }
  return normalized(first.name) === normalized(second.name) && distanceMiles(first, second) < 0.01;
}

function mergePlaces(places) {
  const unique = [];
  for (const place of places) {
    if (!unique.some((existing) => sameLocation(existing, place))) unique.push(place);
  }
  return unique.slice(0, 8);
}

async function photonPlaces(query, bias, houseNumber, signal) {
  const url = new URL(PHOTON_URL);
  url.search = new URLSearchParams({
    q: query, limit: "12", lat: bias.lat, lon: bias.lon, zoom: "8",
    bbox: floridaBounds.join(","), countrycode: "US",
  });
  const response = await fetch(url, { referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error("Place search unavailable");
  const payload = await response.json();
  return payload.features.map((feature) => readPlace(feature, houseNumber));
}

async function censusPlaces(query, signal) {
  const response = await fetch("/api/address-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!response.ok) throw new Error("Address search unavailable");
  return (await response.json()).places;
}

async function searchPlaces(query, signal, origin) {
  const bias = regionalPoint(origin ?? floridaPoly);
  const key = [bias.lat, bias.lon, query.toLowerCase()].join(":");
  if (cache.has(key)) return { places: cache.get(key), partial: false };

  const address = query.match(NUMBERED_ADDRESS);
  const alias = deerfieldPattern.test(address?.[2] ?? query);
  const usesLittleHarbor = /^little harbor way/i.test(address?.[2] ?? "");
  const known = address ? [] : localPlaces.filter((place) => normalized(place.name).startsWith(normalized(query)));
  if (alias && !address) known.unshift(deerfieldStreet);

  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(7000)]);
  const lookups = [photonPlaces(query, bias, address?.[1], requestSignal)];
  if (address && ROAD_ENDING.test(address[2])) {
    if (alias) lookups.push(censusPlaces(address[1] + " NE 11th Way, Deerfield Beach, FL", requestSignal));
    if (!alias || usesLittleHarbor) {
      lookups.push(censusPlaces(query, requestSignal));
    }
  }

  const outcomes = await Promise.allSettled(lookups);
  const remote = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? outcome.value : []).filter(isPlace);
  const withinFlorida = await Promise.all(remote.map(isInFlorida));
  const matched = remote.filter((place, index) => withinFlorida[index] && (address || !alias || !isDeerfieldStreet(place)));
  const named = matched.map((place) => place.houseNumber && isDeerfieldStreet(place) ? {
    ...place,
    name: place.houseNumber + " " + (usesLittleHarbor ? "Little Harbor Way" : "NE 11th Way"),
    address: place.address + " · Also " + (usesLittleHarbor ? "NE 11th Way" : "Little Harbor Way"),
  } : place);

  const places = mergePlaces([...known, ...named]);
  const partial = outcomes.some((outcome) => outcome.status === "rejected");
  if (!partial && !signal.aborted) {
    if (cache.size >= 40) cache.delete(cache.keys().next().value);
    cache.set(key, places);
  }
  return { places, partial };
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

  function placeDescription(place) {
    return [place.address, place.kind === "street" ? "Street" : place.kind === "estimate" ? "Estimated address" : ""].filter(Boolean).join(" · ");
  }

  function choose(index) {
    const place = matches[index];
    reset();
    input.value = place.name;
    onSelect(place);
    status.textContent = [placeDescription(place), getOrigin() && distanceLabel(getOrigin(), place)].filter(Boolean).join(" · ");
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
      if (placeDescription(place)) {
        const address = document.createElement("small");
        address.textContent = placeDescription(place);
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
    const query = input.value.trim().replace(/\s+/g, " ");
    if (normalized(query).length < 3) return;

    const controller = new AbortController();
    request = controller;
    timer = setTimeout(async () => {
      status.textContent = "Searching places…";
      try {
        const { places, partial } = await searchPlaces(query, controller.signal, getOrigin());
        if (controller.signal.aborted) return;
        showResults(places);
        const noResults = NUMBERED_ADDRESS.test(query)
          ? "No numbered address found in Florida. Try adding the city or ZIP code."
          : "No matching places in Florida.";
        status.textContent = places.length ? places.length + " suggestions" : partial ? "Search temporarily unavailable. Try again shortly." : noResults;
      } catch {
        if (!controller.signal.aborted) status.textContent = "Florida search temporarily unavailable. Try again shortly.";
      }
    }, NUMBERED_ADDRESS.test(query) ? 500 : 325);
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
