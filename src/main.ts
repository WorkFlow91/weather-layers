import OBR, { Image, isImage } from "@owlbear-rodeo/sdk";
import "./style.css";

const METADATA_KEY = "weather-layers/weather";

type WeatherType = "NONE" | "RAIN" | "STORM" | "FOG";

type WeatherMetadata = {
  type: WeatherType;
  enabled: boolean;
  intensity: number;
};

type SortMode =
  | "NAME_ASC"
  | "NAME_DESC"
  | "ACTIVE_FIRST"
  | "INACTIVE_FIRST";

let sortMode: SortMode = "NAME_ASC";

function getWeather(item: Image): WeatherMetadata {
  const metadata = item.metadata[METADATA_KEY] as
    | WeatherMetadata
    | undefined;

  return (
    metadata ?? {
      type: "NONE",
      enabled: false,
      intensity: 0.6,
    }
  );
}

function getMapName(item: Image): string {
  const name = item.name?.trim();

  if (name) {
    return name;
  }

  return "Unnamed Map";
}

async function getMaps(): Promise<Image[]> {
  const maps = await OBR.scene.items.getItems(
    (item): item is Image =>
      item.layer === "MAP" && isImage(item)
  );

  return sortMaps(maps);
}

function sortMaps(maps: Image[]): Image[] {
  const result = [...maps];

  result.sort((a, b) => {
    const weatherA = getWeather(a);
    const weatherB = getWeather(b);

    switch (sortMode) {
      case "NAME_DESC":
        return getMapName(b).localeCompare(getMapName(a));

      case "ACTIVE_FIRST": {
        const activeDifference =
          Number(weatherB.enabled) - Number(weatherA.enabled);

        if (activeDifference !== 0) {
          return activeDifference;
        }

        return getMapName(a).localeCompare(getMapName(b));
      }

      case "INACTIVE_FIRST": {
        const activeDifference =
          Number(weatherA.enabled) - Number(weatherB.enabled);

        if (activeDifference !== 0) {
          return activeDifference;
        }

        return getMapName(a).localeCompare(getMapName(b));
      }

      case "NAME_ASC":
      default:
        return getMapName(a).localeCompare(getMapName(b));
    }
  });

  return result;
}

async function setWeatherType(
  mapId: string,
  type: WeatherType
): Promise<void> {
  await OBR.scene.items.updateItems([mapId], (items) => {
    for (const item of items) {
      const previous =
        (item.metadata[METADATA_KEY] as
          | WeatherMetadata
          | undefined) ?? {
          type: "NONE",
          enabled: false,
          intensity: 0.6,
        };

      item.metadata[METADATA_KEY] = {
        ...previous,
        type,
        enabled: type !== "NONE",
      };
    }
  });
}

async function toggleWeather(mapId: string): Promise<void> {
  await OBR.scene.items.updateItems([mapId], (items) => {
    for (const item of items) {
      const previous =
        (item.metadata[METADATA_KEY] as
          | WeatherMetadata
          | undefined) ?? {
          type: "NONE",
          enabled: false,
          intensity: 0.6,
        };

      item.metadata[METADATA_KEY] = {
        ...previous,
        enabled:
          previous.type === "NONE"
            ? false
            : !previous.enabled,
      };
    }
  });
}

async function setIntensity(
  mapId: string,
  intensity: number
): Promise<void> {
  await OBR.scene.items.updateItems([mapId], (items) => {
    for (const item of items) {
      const previous =
        (item.metadata[METADATA_KEY] as
          | WeatherMetadata
          | undefined) ?? {
          type: "NONE",
          enabled: false,
          intensity: 0.6,
        };

      item.metadata[METADATA_KEY] = {
        ...previous,
        intensity,
      };
    }
  });
}

function createMapCard(map: Image): HTMLElement {
  const weather = getWeather(map);

  const card = document.createElement("article");
  card.className = "map-card";

  if (weather.enabled) {
    card.classList.add("weather-active");
  }

  const top = document.createElement("div");
  top.className = "map-top";

  const mapInfo = document.createElement("div");
  mapInfo.className = "map-info";

  const icon = document.createElement("div");
  icon.className = "map-icon";
  icon.textContent = "▧";

  const text = document.createElement("div");
  text.className = "map-text";

  const name = document.createElement("div");
  name.className = "map-name";
  name.textContent = getMapName(map);
  name.title = getMapName(map);

  const state = document.createElement("div");
  state.className = "map-state";

  if (weather.type === "NONE") {
    state.textContent = "No weather";
  } else if (weather.enabled) {
    state.textContent = `${weather.type.toLowerCase()} active`;
  } else {
    state.textContent = `${weather.type.toLowerCase()} disabled`;
  }

  text.append(name, state);
  mapInfo.append(icon, text);

  const toggle = document.createElement("button");
  toggle.className = "toggle-button";
  toggle.disabled = weather.type === "NONE";
  toggle.textContent = weather.enabled ? "On" : "Off";

  if (weather.enabled) {
    toggle.classList.add("active");
  }

  toggle.addEventListener("click", async () => {
    await toggleWeather(map.id);
  });

  top.append(mapInfo, toggle);

  const controls = document.createElement("div");
  controls.className = "map-controls";

  const weatherSelect = document.createElement("select");
  weatherSelect.className = "weather-select";

  const options: Array<{
    value: WeatherType;
    label: string;
  }> = [
    { value: "NONE", label: "No weather" },
    { value: "RAIN", label: "Rain" },
    { value: "STORM", label: "Storm" },
    { value: "FOG", label: "Fog" },
  ];

  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;

    if (weather.type === optionData.value) {
      option.selected = true;
    }

    weatherSelect.appendChild(option);
  }

  weatherSelect.addEventListener("change", async () => {
    await setWeatherType(
      map.id,
      weatherSelect.value as WeatherType
    );
  });

  const intensityRow = document.createElement("div");
  intensityRow.className = "intensity-row";

  const intensityHeader = document.createElement("div");
  intensityHeader.className = "intensity-header";

  const intensityLabel = document.createElement("span");
  intensityLabel.textContent = "Intensity";

  const intensityValue = document.createElement("span");
  intensityValue.className = "intensity-value";
  intensityValue.textContent = `${Math.round(
    weather.intensity * 100
  )}%`;

  intensityHeader.append(intensityLabel, intensityValue);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "5";
  slider.value = String(
    Math.round(weather.intensity * 100)
  );

  slider.disabled = weather.type === "NONE";

  slider.addEventListener("input", () => {
    intensityValue.textContent = `${slider.value}%`;
  });

  slider.addEventListener("change", async () => {
    await setIntensity(
      map.id,
      Number(slider.value) / 100
    );
  });

  intensityRow.append(intensityHeader, slider);
  controls.append(weatherSelect, intensityRow);

  card.append(top, controls);

  return card;
}

async function render(): Promise<void> {
  const root =
    document.querySelector<HTMLDivElement>("#app");

  if (!root) {
    return;
  }

  const maps = await getMaps();

  root.innerHTML = `
    <main class="panel">
      <header class="header">
        <div>
          <h1>Weather Layers</h1>
          <p class="subtitle">
            Map-based weather effects
          </p>
        </div>
      </header>

      <div class="toolbar">
        <div>
          <div class="section-label">
            Maps in scene
          </div>
          <div class="map-count">
            ${maps.length}
            ${maps.length === 1 ? "map" : "maps"}
          </div>
        </div>

        <select
          id="sort-select"
          class="sort-select"
          aria-label="Sort maps"
        >
          <option value="NAME_ASC">
            Name A–Z
          </option>
          <option value="NAME_DESC">
            Name Z–A
          </option>
          <option value="ACTIVE_FIRST">
            Active first
          </option>
          <option value="INACTIVE_FIRST">
            Inactive first
          </option>
        </select>
      </div>

      <section
        id="map-list"
        class="map-list"
      ></section>

      ${
        maps.length === 0
          ? `
            <div class="empty-state">
              <div class="empty-icon">▧</div>
              <p>No map images found.</p>
              <span>
                Add an image to Owlbear's Map
                layer and it will appear here.
              </span>
            </div>
          `
          : ""
      }

      <footer class="footer">
        Weather choices are stored now.
        Rendering comes next.
      </footer>
    </main>
  `;

  const sortSelect =
    document.querySelector<HTMLSelectElement>(
      "#sort-select"
    );

  if (sortSelect) {
    sortSelect.value = sortMode;

    sortSelect.addEventListener(
      "change",
      async () => {
        sortMode =
          sortSelect.value as SortMode;

        await render();
      }
    );
  }

  const list =
    document.querySelector<HTMLDivElement>(
      "#map-list"
    );

  if (list) {
    for (const map of maps) {
      list.appendChild(createMapCard(map));
    }
  }
}

OBR.onReady(async () => {
  await render();

  OBR.scene.items.onChange(async () => {
    await render();
  });

  OBR.scene.onReadyChange(async (ready) => {
    if (ready) {
      await render();
    }
  });
});
