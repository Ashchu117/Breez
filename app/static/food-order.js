import { distanceLabel, isPlace, normalized } from "./places.js?v=6";
import { chains, restaurantLocations } from "./restaurants.js?v=1";

const menu = ["Food item 1", "Food item 2", "Food item 3"];
const options = ["Custom option 1", "Custom option 2", "Custom option 3"];

export function readFoodMission(mission) {
  if (mission?.mode !== "delivery" || mission.source !== "mock-menu" ||
      !Object.hasOwn(chains, mission.chainId) || !isPlace(mission.origin) ||
      (mission.destination !== null && !isPlace(mission.destination)) ||
      !["As soon as possible", "Within one hour"].includes(mission.timing) ||
      !Array.isArray(mission.items) || !mission.items.length) return null;
  const validItems = mission.items.every((item) => menu.includes(item?.name)
    && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 9
    && Array.isArray(item.options) && item.options.every((option) => options.includes(option)));
  return validItems ? mission : null;
}

export function createFoodOrder({ onSave, onRoute }) {
  const dialog = document.querySelector("#food-dialog");
  const steps = [...dialog.querySelectorAll("[data-food-step]")];
  const title = dialog.querySelector("#food-title");
  const back = dialog.querySelector("#food-back");
  const restaurantForm = dialog.querySelector("#restaurant-search");
  const query = dialog.querySelector("#restaurant-query");
  const status = dialog.querySelector("#restaurant-status");
  const branches = dialog.querySelector("#restaurant-results");
  const menuItems = dialog.querySelector("#mock-menu");
  const customize = dialog.querySelector("#customize-food");
  const optionList = dialog.querySelector("#food-options");
  const quantity = dialog.querySelector("#food-quantity");
  const concierge = dialog.querySelector("#concierge-form");
  const message = dialog.querySelector("#concierge-message");
  const conciergeStatus = dialog.querySelector("#concierge-status");
  const send = concierge.querySelector("button[type=submit]");
  let conversation;
  let suggestion;
  let inference;
  const review = dialog.querySelector("#review-order");
  const cartList = dialog.querySelector("#food-cart");
  const timing = dialog.querySelector("#delivery-timing");
  const simulate = dialog.querySelector("#simulate-delivery");
  const simulationProgress = dialog.querySelector("#simulation-progress");
  let simulationRequest;
  let request;
  let chainId;
  let pickup;
  let dropoff;
  let cart;
  let step;
  let activeItem;

  function show(name, heading) {
    cancelSimulation();
    step = name;
    for (const section of steps) section.hidden = section.dataset.foodStep !== name;
    back.hidden = name === "chains";
    title.textContent = heading;
    title.focus();
  }

  function lineButton(label, detail, choose) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("strong");
    name.textContent = label;
    button.append(name);
    if (detail) {
      const description = document.createElement("small");
      description.textContent = detail;
      button.append(description);
    }
    button.addEventListener("click", choose);
    row.append(button);
    return row;
  }

  function showChains() {
    show("chains", "Supported chains");
    dialog.querySelector("#food-dropoff").textContent = "Deliver to " + dropoff.name;
  }

  function showBranches() {
    query.value = "";
    show("branches", "Choose a " + chains[chainId].name + " location");
    dialog.querySelector("#change-store-note").hidden = !cart.length;
    findBranches();
  }

  async function findBranches() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    branches.replaceChildren();
    status.textContent = "Finding Florida locations…";
    try {
      const { places, unavailable } = await restaurantLocations(chainId, query.value.trim(), dropoff, controller.signal);
      if (controller.signal.aborted || !dialog.open || step !== "branches") return;
      for (const place of places) {
        branches.append(lineButton(place.address, distanceLabel(dropoff, place) + " from drop-off", () => {
          if (!pickup || pickup.address !== place.address || pickup.name !== place.name) cart = [];
          pickup = place;
          if (suggestion) {
            cart = suggestion.cargo;
            timing.value = suggestion.timing;
            suggestion = undefined;
            showCart();
          } else showMenu();
        }));
      }
      status.textContent = unavailable
        ? places.length ? "Live lookup unavailable. Showing saved Lakeland locations." : "Location lookup unavailable. Try searching again."
        : places.length ? "" : "No mapped locations found. Try a Florida city or ZIP code.";
    } catch {
      if (!controller.signal.aborted) status.textContent = "Location lookup unavailable. Try again.";
    }
  }

  function showMenu() {
    show("menu", chains[chainId].name + " mock menu");
    dialog.querySelector("#menu-location").textContent = pickup.address;
    const count = cart.reduce((total, item) => total + item.quantity, 0);
    review.disabled = !count;
    review.textContent = count ? "Review order (" + count + ")" : "Review order";
  }

  function customizeItem(name) {
    activeItem = name;
    customize.reset();
    show("item", name);
  }

  function showCart() {
    show("cart", "Review your order");
    dialog.querySelector("#cart-pickup").textContent = pickup.name + " · " + pickup.address;
    dialog.querySelector("#cart-dropoff").textContent = dropoff.name;
    cartList.replaceChildren();
    for (const [index, item] of cart.entries()) {
      const row = document.createElement("li");
      const detail = document.createElement("span");
      detail.textContent = item.quantity + " × " + item.name;
      if (item.options.length) {
        const note = document.createElement("small");
        note.textContent = item.options.join(", ");
        detail.append(note);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + item.name + " from order");
      remove.addEventListener("click", () => {
        cart.splice(index, 1);
        if (cart.length) showCart();
        else showMenu();
      });
      row.append(detail, remove);
      cartList.append(row);
    }
  }

  for (const [id, chain] of Object.entries(chains)) {
    dialog.querySelector("#supported-chains").append(lineButton(chain.name, "", () => {
      chainId = id;
      showBranches();
    }));
  }
  for (const item of menu) menuItems.append(lineButton(item, "Customize", () => customizeItem(item)));
  for (const option of options) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "custom-option";
    input.value = option;
    label.append(input, option);
    optionList.append(label);
  }

  function showConcierge() {
    message.value = "";
    conciergeStatus.textContent = "";
    send.disabled = false;
    show("concierge", "Describe your order");
  }

  dialog.querySelector("#open-concierge").addEventListener("click", showConcierge);
  concierge.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (send.disabled || !message.value.trim()) return;
    const controller = new AbortController();
    inference = controller;
    send.disabled = true;
    conciergeStatus.textContent = "Reading your order…";
    try {
      const response = await fetch("/api/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.value.trim(), previous: conversation ?? null }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (controller.signal.aborted || !dialog.open) return;
      if (!response.ok) {
        conciergeStatus.textContent = response.status !== 404 && typeof result.detail === "string"
          ? result.detail : "The concierge is unavailable. Go back to use the menu.";
        return;
      }

      conversation = result;
      const namedChain = normalized(result.origin ?? "");
      const chain = Object.keys(chains).find((id) => namedChain.includes(normalized(chains[id].name)));
      const cargo = result.cargo?.map((item) => ({
        name: menu.find((name) => normalized(name) === normalized(item.name)),
        quantity: item.quantity,
        options: item.options.map((option) => options.find((name) => normalized(name) === normalized(option))),
      }));
      message.value = "";
      if (!chain) conciergeStatus.textContent = "Which chain should we use: McDonald’s, Wendy’s, or Burger King?";
      else if (!cargo?.length || cargo.some((item) => !item.name || item.quantity > 9 || item.options.includes(undefined))) {
        conciergeStatus.textContent = "Choose Food item 1, 2, or 3, up to 9 per item. Custom options 1, 2, and 3 are available.";
      } else if (!result.timing) conciergeStatus.textContent = "As soon as possible, or within one hour?";
      else {
        chainId = chain;
        suggestion = { cargo, timing: result.timing };
        showBranches();
        return;
      }
      message.focus();
    } catch {
      if (!controller.signal.aborted) conciergeStatus.textContent = "The concierge is unavailable. Go back to use the menu.";
    } finally {
      if (inference === controller) send.disabled = false;
    }
  });

  back.addEventListener("click", () => {
    if (step === "branches" || step === "concierge") {
      request?.abort();
      inference?.abort();
      suggestion = undefined;
      showChains();
    } else if (step === "menu") showBranches();
    else showMenu();
  });
  dialog.querySelector("#close-food").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    request?.abort();
    inference?.abort();
    cancelSimulation();
  });
  restaurantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    findBranches();
  });
  customize.addEventListener("submit", (event) => {
    event.preventDefault();
    cart.push({
      name: activeItem,
      quantity: quantity.valueAsNumber,
      options: new FormData(customize).getAll("custom-option"),
    });
    showMenu();
  });
  review.addEventListener("click", showCart);
  function currentMission() {
    return {
      mode: "delivery", source: "mock-menu", chainId, origin: pickup,
      destination: { ...dropoff, address: dropoff.address ?? "" },
      items: cart, timing: timing.value,
    };
  }

  function cancelSimulation() {
    simulationRequest?.abort();
    simulationRequest = undefined;
    simulationProgress.textContent = "";
    simulate.disabled = false;
  }

  timing.addEventListener("change", cancelSimulation);
  simulate.addEventListener("click", async () => {
    if (!cart.length || simulationRequest) return;
    const mission = currentMission();
    const point = ({ name, address, lat, lon }) => ({ name, address, lat, lon });
    const controller = new AbortController();
    simulationRequest = controller;
    simulate.disabled = true;
    simulationProgress.textContent = "Simulating delivery route…";
    try {
      const response = await fetch("/api/route-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: point(mission.origin),
          destination: point(mission.destination),
          cargo: mission.items,
          timing: mission.timing,
          confirmed: true,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      const result = await response.json();
      if (controller.signal.aborted || !dialog.open) return;
      if (!response.ok) {
        simulationProgress.textContent = response.status === 422 && typeof result.detail === "string"
          ? result.detail : "The route simulation is unavailable. Try again or save your draft.";
        return;
      }
      dialog.close();
      onRoute(mission, result);
    } catch {
      if (!controller.signal.aborted) {
        simulationProgress.textContent = "The route simulation is unavailable. Try again or save your draft.";
      }
    } finally {
      if (simulationRequest === controller) {
        simulationRequest = undefined;
        simulate.disabled = false;
      }
    }
  });

  dialog.querySelector("#save-food-order").addEventListener("click", () => {
    if (!cart.length) return;
    onSave(currentMission());
    dialog.close();
  });

  return {
    open(point, mission) {
      conversation = undefined;
      suggestion = undefined;
      dropoff = point;
      chainId = mission?.chainId;
      pickup = mission?.origin;
      cart = mission?.items.map((item) => ({ ...item })) ?? [];
      timing.value = mission?.timing ?? "As soon as possible";
      dialog.showModal();
      if (pickup) showCart();
      else showChains();
    },
  };
}
