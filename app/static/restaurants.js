import { floridaPoly, isInFlorida, regionalPoint } from "./geography.js?v=1";
import { distanceMiles, isPlace, normalized, photonPlaces } from "./places.js?v=8";

export const chains = {
  mcdonalds: { name: "McDonald’s", query: "McDonald's" },
  wendys: { name: "Wendy’s", query: "Wendy's" },
  burgerKing: { name: "Burger King", query: "Burger King" },
};

// Lakeland branches from the official restaurant locators, with U.S. Census address estimates.
const lakelandBranches = {
  mcdonalds: [
    ["3420 US Highway 98 N", 28.08675, -81.97211],
    ["2835 S Florida Ave", 28.01165, -81.95709],
  ],
  wendys: [
    ["5740 Highway 98 North", 28.12009, -81.97385],
    ["3929 S Florida Ave", 27.99247, -81.95707],
  ],
  burgerKing: [
    ["2095 W Memorial Blvd", 28.05490, -81.98966],
    ["3590 Harden Boulevard", 28.00022, -81.97479],
  ],
};

function localBranches(chainId, query, dropoff) {
  if (!query && distanceMiles(dropoff, floridaPoly) > 40) return [];
  const term = normalized(query);
  return lakelandBranches[chainId].flatMap(([street, lat, lon]) => {
    const address = street + ", Lakeland, FL";
    if (term && !normalized(address).includes(term)) return [];
    return [{ name: chains[chainId].name, address, area: "Lakeland", lat, lon }];
  });
}

export async function restaurantLocations(chainId, query, dropoff, signal) {
  const chain = chains[chainId];
  const local = localBranches(chainId, query, dropoff);
  let matches = [];
  let unavailable = false;
  try {
    const search = [chain.query, query].filter(Boolean).join(" ");
    const remote = await photonPlaces(search, regionalPoint(dropoff), null,
      AbortSignal.any([signal, AbortSignal.timeout(6500)]), { limit: "32", osm_tag: "amenity:fast_food" });
    const matching = remote.filter((place) => isPlace(place) && normalized(place.name) === chainId.toLowerCase());
    const withinFlorida = await Promise.all(matching.map(isInFlorida));
    matches = matching.filter((_, index) => withinFlorida[index]);
  } catch (error) {
    if (signal.aborted) throw error;
    unavailable = true;
  }

  const distinct = [];
  for (const place of [...matches, ...local]) {
    if (!place.address || distinct.some((other) => distanceMiles(place, other) < 0.08)) continue;
    distinct.push({ ...place, name: chain.name });
  }
  distinct.sort((first, second) => distanceMiles(dropoff, first) - distanceMiles(dropoff, second));
  return { places: distinct.slice(0, 10), unavailable };
}

