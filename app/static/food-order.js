import { distanceLabel, isPlace } from "./places.js?v=6";
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

export function createFoodOrder({ onSave }) {
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
  const review = dialog.querySelector("#review-order");
  const cartList = dialog.querySelector("#food-cart");
  const timing = dialog.querySelector("#delivery-timing");
  let request;
  let chainId;
  let pickup;
  let dropoff;
  let cart;
  let step;
  let activeItem;

  function show(name, heading) {
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
          showMenu();
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

  back.addEventListener("click", () => {
    if (step === "branches") {
      request?.abort();
      showChains();
    } else if (step === "menu") showBranches();
    else showMenu();
  });
  dialog.querySelector("#close-food").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => request?.abort());
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
  dialog.querySelector("#save-food-order").addEventListener("click", () => {
    if (!cart.length) return;
    const destination = { ...dropoff, address: dropoff.address ?? "" };
    onSave({
      mode: "delivery", source: "mock-menu", chainId, origin: pickup,
      destination, items: cart, timing: timing.value,
    });
    dialog.close();
  });

  return {
    open(point, mission) {
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
