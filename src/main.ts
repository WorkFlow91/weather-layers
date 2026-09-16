import OBR, { Item } from "@owlbear-rodeo/sdk";
import "./style.css";

const METADATA_KEY = "weather-layers/overlay";

type WeatherMetadata = {
  enabled: boolean;
};

function isWeatherLayer(item: Item): boolean {
  const metadata = item.metadata[METADATA_KEY] as WeatherMetadata | undefined;
  return metadata?.enabled === true;
}

function getDisplayName(item: Item): string {
  if (item.name && item.name.trim().length > 0) {
    return item.name;
  }

  return "Unnamed Weather Layer";
}

async function getWeatherLayers(): Promise<Item[]> {
  const items = await OBR.scene.items.getItems();

  return items.filter(isWeatherLayer);
}

async function addSelectedItems(): Promise<void> {
  const selection = await OBR.player.getSelection();

  if (!selection || selection.length === 0) {
    await OBR.notification.show("Select one or more items first.", "WARNING");
    return;
  }

  await OBR.scene.items.updateItems(selection, (items) => {
    for (const item of items) {
      item.locked = true;
      item.disableHit = true;

      item.metadata[METADATA_KEY] = {
        enabled: true,
      };
    }
  });

  await OBR.notification.show(
    `${selection.length} item${selection.length === 1 ? "" : "s"} added to Weather Layers.`,
    "SUCCESS"
  );

  await render();
}

async function removeWeatherLayer(id: string): Promise<void> {
  await OBR.scene.items.updateItems([id], (items) => {
    for (const item of items) {
      item.locked = false;
      item.disableHit = false;

      delete item.metadata[METADATA_KEY];
    }
  });

  await render();
}

async function toggleVisibility(id: string): Promise<void> {
  const matchingItems = await OBR.scene.items.getItems([id]);

  if (matchingItems.length === 0) {
    return;
  }

  const currentVisibility = matchingItems[0].visible;

  await OBR.scene.items.updateItems([id], (items) => {
    for (const item of items) {
      item.visible = !currentVisibility;
    }
  });

  await render();
}

function createLayerRow(item: Item): HTMLElement {
  const row = document.createElement("div");
  row.className = "layer-row";

  const nameArea = document.createElement("div");
  nameArea.className = "layer-name-area";

  const icon = document.createElement("span");
  icon.className = "layer-icon";
  icon.textContent = "☁";

  const name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = getDisplayName(item);
  name.title = getDisplayName(item);

  nameArea.append(icon, name);

  const controls = document.createElement("div");
  controls.className = "layer-controls";

  const visibilityButton = document.createElement("button");
  visibilityButton.className = "icon-button";
  visibilityButton.title = item.visible ? "Hide layer" : "Show layer";
  visibilityButton.setAttribute(
    "aria-label",
    item.visible ? "Hide layer" : "Show layer"
  );

  visibilityButton.textContent = item.visible ? "👁" : "◌";

  visibilityButton.addEventListener("click", async () => {
    await toggleVisibility(item.id);
  });

  const removeButton = document.createElement("button");
  removeButton.className = "icon-button remove-button";
  removeButton.title = "Remove from Weather Layers";
  removeButton.setAttribute("aria-label", "Remove from Weather Layers");
  removeButton.textContent = "×";

  removeButton.addEventListener("click", async () => {
    await removeWeatherLayer(item.id);
  });

  controls.append(visibilityButton, removeButton);

  row.append(nameArea, controls);

  return row;
}

async function render(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>("#app");

  if (!root) {
    return;
  }

  const weatherLayers = await getWeatherLayers();

  root.innerHTML = `
    <main class="panel">
      <header class="header">
        <div>
          <h1>Weather Layers</h1>
          <p class="subtitle">Click-through overlays</p>
        </div>
      </header>

      <section class="layers-section">
        <div class="section-title">
          <span>Layers</span>
          <span class="layer-count">${weatherLayers.length}</span>
        </div>

        <div id="layer-list" class="layer-list"></div>

        ${
          weatherLayers.length === 0
            ? `
              <div class="empty-state">
                <div class="empty-icon">☁</div>
                <p>No weather layers yet.</p>
                <span>Select an image on the canvas and add it below.</span>
              </div>
            `
            : ""
        }
      </section>

      <footer class="footer">
        <button id="add-selected" class="primary-button">
          <span class="button-plus">+</span>
          Add Selected
        </button>
      </footer>
    </main>
  `;

  const list = document.querySelector<HTMLDivElement>("#layer-list");

  if (list) {
    for (const item of weatherLayers) {
      list.appendChild(createLayerRow(item));
    }
  }

  const addButton = document.querySelector<HTMLButtonElement>("#add-selected");

  addButton?.addEventListener("click", async () => {
    await addSelectedItems();
  });
}

OBR.onReady(async () => {
  await render();

  OBR.scene.items.onChange(async () => {
    await render();
  });
});
