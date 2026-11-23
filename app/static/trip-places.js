import { regionalPoint } from "./geography.js?v=1";
import { distanceMiles } from "./places.js?v=9";

export const tripCategories = {
  supermarket: "Supermarkets",
  pharmacy: "Pharmacies",
  restaurant: "Restaurants",
  cafe: "Cafés",
  park: "Parks",
  hospital: "Hospitals",
  car_repair: "Auto repair shops",
};

export async function findTripPlaces(category, city, origin, signal) {
  const response = await fetch("/api/trip-places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, city, region: regionalPoint(origin) }),
    signal,
  });
  if (!response.ok) throw new Error("Category search unavailable");
  const places = await response.json();
  const ranked = places.map((place) => ({ place, distance: distanceMiles(origin, place) }))
    .sort((a, b) => a.distance - b.distance);
  const matches = [];
  for (const { place } of ranked) {
    if (matches.some((other) => other.name === place.name && distanceMiles(other, place) < 0.08)) continue;
    matches.push(place);
    if (matches.length === 8) break;
  }
  return matches;
}
