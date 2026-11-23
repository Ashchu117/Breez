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

export function normalized(value) {
  return value.normalize("NFD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function isPlace(place) {
  return typeof place?.name === "string" && place.name.length > 0
    && typeof place.address === "string"
    && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90
    && Number.isFinite(place.lon) && Math.abs(place.lon) <= 180;
}

export function distanceMiles(from, to) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const a = Math.sin(rad(to.lat - from.lat) / 2) ** 2
    + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lon - from.lon) / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanceLabel(from, to) {
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
  const name = houseNumber && !number.toLowerCase().startsWith(houseNumber.toLowerCase()) ? null : placeName;
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

export async function photonPlaces(query, bias, houseNumber, signal, options = {}) {
  const url = new URL(PHOTON_URL);
  url.search = new URLSearchParams({
    q: query, limit: "12", lat: bias.lat, lon: bias.lon, zoom: "8",
    bbox: floridaBounds.join(","), countrycode: "US", ...options,
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

const streetAbbreviations = {
  n: "north", s: "south", e: "east", w: "west",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
  ave: "avenue", blvd: "boulevard", ct: "court", dr: "drive", hwy: "highway",
  ln: "lane", pkwy: "parkway", pl: "place", rd: "road", st: "street",
  ter: "terrace", trl: "trail",
};

function streetKey(value, expandLast = true) {
  const text = value.toLowerCase().replace(/\b(north|south)\s+(east|west)\b/g, "$1$2");
  const words = text.match(/[a-z]+|[0-9]+/g) ?? [];
  return words.map((word, index) => {
    const expand = expandLast || index < words.length - 1;
    return expand && Object.hasOwn(streetAbbreviations, word) ? streetAbbreviations[word] : word;
  }).join("");
}

function matchesStreetText(query, street) {
  const text = query.split(",")[0];
  const typed = streetKey(text);
  const full = streetKey(street);
  if (!typed || !full) return false;
  return full.startsWith(typed) || full.startsWith(streetKey(text, false)) || (
    ROAD_ENDING.test(query) && typed.startsWith(full) && full.length >= 5
  );
}

function deerfieldCompletion(fragment) {
  const typed = streetKey(fragment, false);
  if (deerfieldPattern.test(fragment)) {
    return /^little/i.test(fragment) ? "Little Harbor Way" : "NE 11th Way";
  }
  if (typed.length < 6) return null;
  if (streetKey("Little Harbor Way").startsWith(typed)) return "Little Harbor Way";
  return streetKey("NE 11th Way").startsWith(typed) && /\d/.test(typed) ? "NE 11th Way" : null;
}

function combineAddressSuggestions(addresses, completions) {
  const remaining = completions.filter((completion) => !addresses.some((place) =>
    streetKey(completion.name) === streetKey(place.name) &&
    (!completion.area || normalized(completion.area) === normalized(place.area ?? ""))
  ));
  return [...addresses, ...remaining];
}

function nameAddress(place, alias) {
  if (!alias || !place.houseNumber || !isDeerfieldStreet(place)) return place;
  return {
    ...place,
    name: place.houseNumber + " " + alias,
    address: place.address + " · Also " + (alias === "Little Harbor Way" ? "NE 11th Way" : "Little Harbor Way"),
  };
}

async function censusRoads(fragment, bias, signal) {
  const prefix = fragment.split(",")[0].trim().toUpperCase();
  if (prefix.length < 4 || !/^[\p{L}\p{N} '.-]+$/u.test(prefix)) return [];
  const abbreviated = prefix.replace(/^(NORTH|SOUTH|EAST|WEST)(?= )/, (word) => word[0]);
  const where = [...new Set([prefix, abbreviated])]
    .map((term) => "UPPER(NAME) LIKE '" + term.replaceAll("'", "''") + "%'").join(" OR ");
  const nearby = [bias.lon - 0.65, bias.lat - 0.65, bias.lon + 0.65, bias.lat + 0.65];
  for (const bounds of [nearby, floridaBounds]) {
    if (signal.aborted) return [];
    const url = new URL("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8/query");
    url.search = new URLSearchParams({
      f: "json", where, geometry: bounds.join(","), geometryType: "esriGeometryEnvelope",
      inSR: "4326", outSR: "4326", outFields: "NAME", resultRecordCount: "24",
    });
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(2400)]);
    const response = await fetch(url, { referrerPolicy: "no-referrer", signal: requestSignal });
    if (!response.ok) throw new Error("Census street lookup unavailable");
    const { features } = await response.json();
    if (!Array.isArray(features)) throw new Error("Census street lookup unavailable");
    const streets = features.flatMap(({ attributes, geometry }) => {
      const [lon, lat] = geometry?.paths?.[0]?.[0] ?? [];
      return [{ name: attributes?.NAME, address: "Florida", lat, lon, kind: "street" }];
    }).filter(isPlace);
    const florida = await Promise.all(streets.map(isInFlorida));
    const unique = new Map(streets.filter((_, index) => florida[index])
      .map((place) => [streetKey(place.name), place]));
    if (unique.size) return [...unique.values()];
  }
  return [];
}

async function matchingStreetCandidates(fragment, bias, signal) {
  try {
    const roads = await censusRoads(fragment, bias, signal);
    if (roads.length) return roads;
  } catch {
    if (signal.aborted) return [];
  }
  return photonPlaces(fragment, bias, undefined, signal, { layer: "street" });
}

async function streetCompletions(fragment, number, bias, signal, alias) {
  const candidates = alias
    ? [{ ...deerfieldStreet, name: alias }]
    : await matchingStreetCandidates(fragment, bias, signal);
  const streets = mergePlaces(candidates.filter((place) => isPlace(place) && place.kind === "street"
    && (alias || matchesStreetText(fragment, place.name))));
  const withinFlorida = await Promise.all(streets.map(isInFlorida));
  return streets.filter((_, index) => withinFlorida[index]).map((place) => {
    const area = place.area === place.name ? "" : place.area;
    const name = number + " " + place.name;
    return {
      ...place,
      name,
      street: place.name,
      kind: "completion",
      searchQuery: [name, area, "FL"].filter(Boolean).join(", "),
      censusQuery: [alias ? number + " NE 11th Way" : name, area, "FL"].filter(Boolean).join(", "),
    };
  });
}

async function namedPlaces(query, bias, signal) {
  const primarySignal = AbortSignal.any([signal, AbortSignal.timeout(3200)]);
  try {
    const results = (await photonPlaces(query, bias, undefined, primarySignal)).filter(isPlace);
    const inFlorida = await Promise.all(results.map(isInFlorida));
    const floridaResults = results.filter((_, index) => inFlorida[index]);
    if (floridaResults.length) return floridaResults;
  } catch {
    if (signal.aborted) return [];
  }

  const prefix = query.replace(/,?\s+(?:Florida|FL)$/i, "").trim().toUpperCase();
  if (prefix.length < 3 || !/^[\p{L}\p{N} '.-]+$/u.test(prefix)) return [];
  const where = "STATE='12' AND UPPER(BASENAME) LIKE '" + prefix.replaceAll("'", "''") + "%'";
  const params = new URLSearchParams({
    f: "json", where, returnGeometry: "false",
    outFields: "BASENAME,INTPTLAT,INTPTLON", resultRecordCount: "8",
  });
  const root = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer";
  const sources = [4, 5].map(async (layer) => {
    const response = await fetch(root + "/" + layer + "/query?" + params, {
      referrerPolicy: "no-referrer", signal,
    });
    if (!response.ok) throw new Error("Census place search unavailable");
    const { features } = await response.json();
    return features.map(({ attributes }) => ({
      name: attributes.BASENAME, address: "Florida", area: attributes.BASENAME,
      lat: Number(attributes.INTPTLAT), lon: Number(attributes.INTPTLON), kind: "locality",
    }));
  });
  const replies = await Promise.allSettled(sources);
  if (replies.every((reply) => reply.status === "rejected")) throw new Error("Place search unavailable");
  return replies.flatMap((reply) => reply.status === "fulfilled" ? reply.value : []);
}

async function searchPlaces(query, signal, origin, preview) {
  const bias = regionalPoint(origin ?? floridaPoly);
  const key = [bias.lat, bias.lon, query.toLowerCase()].join(":");
  if (cache.has(key)) return { places: cache.get(key), partial: false };

  const address = query.match(NUMBERED_ADDRESS);
  const fragment = address?.[2] ?? query;
  const alias = deerfieldCompletion(fragment);
  const usesLittleHarbor = alias === "Little Harbor Way";
  const known = address ? [] : localPlaces.filter((place) => normalized(place.name).startsWith(normalized(query)));
  if (alias && !address) known.unshift(deerfieldStreet);

  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(7000)]);
  if (known.length) preview(known);
  const lookups = [address ? photonPlaces(query, bias, address[1], requestSignal) : namedPlaces(query, bias, requestSignal)];
  const completeStreet = address && ROAD_ENDING.test(fragment);
  let completions = [];
  if (completeStreet) {
    if (alias) lookups.push(censusPlaces(address[1] + " NE 11th Way, Deerfield Beach, FL", requestSignal));
    if (!alias || usesLittleHarbor) lookups.push(censusPlaces(query, requestSignal));
  } else if (address && normalized(fragment).length >= 3) {
    lookups.push((async () => {
      completions = await streetCompletions(fragment, address[1], bias, requestSignal, alias);
      if (signal.aborted || !completions.length) return [];
      preview(completions);
      const results = await Promise.allSettled(completions.slice(0, 2).map(async (place) => {
        const estimates = await censusPlaces(place.censusQuery, requestSignal);
        return estimates.filter((estimate) => (
          streetKey(estimate.street ?? "") === streetKey(place.street) ||
          alias && isDeerfieldStreet(estimate)
        ) && (!place.area || normalized(estimate.area ?? "") === normalized(place.area)));
      }));
      const estimates = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      const florida = await Promise.all(estimates.map(isInFlorida));
      const verified = estimates.filter((_, index) => florida[index]).map((place) => nameAddress(place, alias));
      if (verified.length && !signal.aborted) preview(mergePlaces(combineAddressSuggestions(verified, completions)));
      return estimates;
    })());
  }

  const outcomes = await Promise.allSettled(lookups);
  const remote = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? outcome.value : []).filter(isPlace);
  const withinFlorida = await Promise.all(remote.map(isInFlorida));
  const matched = remote.filter((place, index) => {
    if (!withinFlorida[index]) return false;
    if (!address) return !alias || !isDeerfieldStreet(place);
    return (alias && isDeerfieldStreet(place)) || matchesStreetText(fragment, place.street ?? "");
  });
  const named = matched.map((place) => nameAddress(place, alias));
  const places = mergePlaces([...known, ...combineAddressSuggestions(named, completions)]);
  const partial = outcomes.some((outcome) => outcome.status === "rejected");
  if (!partial && !places.some((place) => place.kind === "completion") && !signal.aborted) {
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
    const kind = { street: "Street", estimate: "Estimated address", locality: "Census place reference point", completion: "Complete address search" }[place.kind];
    return [place.address, kind].filter(Boolean).join(" · ");
  }

  function choose(index) {
    const place = matches[index];
    reset();
    if (place.kind === "completion") {
      input.value = place.searchQuery;
      input.dispatchEvent(new Event("input"));
      input.focus();
      return;
    }
    input.value = place.name;
    onSelect(place);
    status.textContent = [placeDescription(place), getOrigin() && distanceLabel(getOrigin(), place)].filter(Boolean).join(" · ");
    input.focus();
  }

  function showResults(places) {
    clearResults();
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
      if (origin && place.kind !== "completion") {
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
        const { places, partial } = await searchPlaces(query, controller.signal, getOrigin(), (completions) => {
          if (!controller.signal.aborted) {
            showResults(completions);
            status.textContent = completions.some((place) => place.kind === "completion")
              ? "Checking matching street addresses…" : completions.length + " suggestions";
          }
        });
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
  return {
    reset,
    setEnabled,
    setSuggestions(places) {
      reset();
      showResults(places);
    },
  };
}
