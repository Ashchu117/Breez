export const sampleDelivery = {
  origin: { name: "Lakeland Demo Hub", area: "Lakeland", lat: 28.044, lon: -81.952 },
  destination: { name: "Winter Haven Demo Hub", area: "Winter Haven", lat: 28.026, lon: -81.729 },
  cargo: "One insulated lunch bag",
  timing: "Within 45 minutes",
};

export function createSampleMission(cargo, timing) {
  return {
    mode: "delivery",
    source: "demo",
    origin: sampleDelivery.origin,
    destination: sampleDelivery.destination,
    cargo,
    timing,
  };
}
