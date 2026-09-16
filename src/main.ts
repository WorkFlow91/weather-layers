import OBR, { Image, isImage } from "@owlbear-rodeo/sdk";
import "./style.css";

const METADATA_KEY = "weather-layers/weather";

type WeatherEffectType =
  | "CLOUDS"
  | "RAIN"
  | "SNOW"
  | "FOG"
  | "LIGHTNING";

type EffectSettings = {
  enabled: boolean;
  intensity: number;
};

type WeatherMetadata = {
  version: 2;
  effects: Partial<Record<WeatherEffectType, EffectSettings>>;
};

type LegacyWeatherMetadata = {
  type?: "NONE" | "RAIN" | "STORM" | "FOG";
  enabled?: boolean;
  intensity?: number;
};

type SortMode =
  | "NAME_ASC"
  | "NAME_DESC"
  | "ACTIVE_FIRST"
  | "INACTIVE_FIRST";

const EFFECTS: Array<{
  type: WeatherEffectType;
  label: string;
  icon: string;
}> = [
  {
    type: "CLOUDS",
    label: "Clouds",
    icon: "☁",
  },
  {
    type: "RAIN",
    label: "Rain",
    icon: "🌧",
  },
  {
    type: "SNOW",
    label: "Snow",
    icon: "❄",
  },
  {
    type: "FOG",
    label: "Fog",
    icon: "≋",
  },
  {
    type: "LIGHTNING",
    label: "Lightning",
    icon: "⚡",
  },
];

let sortMode: SortMode = "NAME_ASC";

/*
 * Expansion is deliberately local UI state.
 * It is not stored in Owlbear metadata.
 */
const expandedMaps = new Set<string>();

function getDefaultEffectSettings(): EffectSettings {
  return {
    enabled: false,
    intensity: 0.6,
  };
}

/*
 * Converts our old single-weather format to the new
 * multiple-effects structure automatically.
 */
function getWeather(item: Image): WeatherMetadata {
  const raw = item.metadata[METADATA_KEY];

  if (
    raw &&
    typeof raw === "object" &&
    "version" in raw &&
    (raw as WeatherMetadata).version === 2
  ) {
    return raw as WeatherMetadata;
  }

  const legacy = raw as LegacyWeatherMetadata | undefined;

  const effects: WeatherMetadata["effects"] = {};

  if (legacy?.type && legacy.type !== "NONE") {
    const intensity =
      typeof legacy.intensity === "number"
        ? legacy.intensity
        : 0.6;

    const enabled = legacy.enabled ?? true;

    if (legacy.type === "RAIN") {
      effects.RAIN = {
        enabled,
        intensity,
      };
    }

    if (legacy.type === "FOG") {
      effects.FOG = {
        enabled,
        intensity,
      };
    }

    /*
     * Old "Storm" becomes clouds + rain.
     * Lightning can then be enabled separately.
     */
    if (legacy.type === "STORM") {
      effects.CLOUDS = {
        enabled,
        intensity,
      };

      effects.RAIN = {
        enabled,
        intensity,
      };
    }
  }

  return {
    version: 2,
    effects,
  };
}

function getEffectSettings(
  weather: WeatherMetadata,
  type: WeatherEffectType
): EffectSettings {
  return (
    weather.effects[type] ??
    getDefaultEffectSettings()
  );
}

function getMapName(item: Image): string {
  const name = item.name?.trim();

  return name || "Unnamed Map";
}

function getActiveEffects(
  weather: WeatherMetadata
): WeatherEffectType[] {
  return EFFECTS
    .filter(({ type }) => {
      return getEffectSettings(
        weather,
        type
      ).enabled;
    })
    .map(({ type }) => type);
}

function hasActiveWeather(item: Image): boolean {
  return getActiveEffects(getWeather(item)).length > 0;
}

function getWeatherSummary(item: Image): string {
  const weather = getWeather(item);
  const active = getActiveEffects(weather);

  if (active.length === 0) {
    return "No active effects";
  }

  const labels = active.map((type) => {
    return (
      EFFECTS.find(
        (effect) => effect.type === type
      )?.label ?? type
    );
  });

  return labels.join(", ");
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
    const activeA = hasActiveWeather(a);
    const activeB = hasActiveWeather(b);

    switch (sortMode) {
      case "NAME_DESC":
        return getMapName(b).localeCompare(
          getMapName(a)
        );

      case "ACTIVE_FIRST": {
        const difference =
          Number(activeB) - Number(activeA);

        if (difference !== 0) {
          return difference;
        }

        return getMapName(a).localeCompare(
          getMapName(b)
        );
      }

      case "INACTIVE_FIRST": {
        const difference =
          Number(activeA) - Number(activeB);

        if (difference !== 0) {
          return difference;
        }

        return getMapName(a).localeCompare(
          getMapName(b)
        );
      }

      case "NAME_ASC":
      default:
        return getMapName(a).localeCompare(
          getMapName(b)
        );
    }
  });

  return result;
}

async function updateEffect(
  mapId: string,
  type: WeatherEffectType,
  updates: Partial<EffectSettings>
): Promise<void> {
  await OBR.scene.items.updateItems(
    [mapId],
    (items) => {
      for (const item of items) {
        if (!isImage(item)) {
          continue;
        }

        const weather = getWeather(item);

        const previous = getEffectSettings(
          weather,
          type
        );

        const nextWeather: WeatherMetadata = {
          version: 2,
          effects: {
            ...weather.effects,
            [type]: {
              ...previous,
              ...updates,
            },
          },
        };

        item.metadata[METADATA_KEY] =
          nextWeather;
      }
    }
  );
}

async function toggleEffect(
  mapId: string,
  type: WeatherEffectType
): Promise<void> {
  const items =
    await OBR.scene.items.getItems([mapId]);

  if (items.length === 0) {
    return;
  }

  const item = items[0];

  if (!isImage(item)) {
    return;
  }

  const weather = getWeather(item);

  const settings = getEffectSettings(
    weather,
    type
  );

  await updateEffect(mapId, type, {
    enabled: !settings.enabled,
  });
}

async function setIntensity(
  mapId: string,
  type: WeatherEffectType,
  intensity: number
): Promise<void> {
  await updateEffect(mapId, type, {
    intensity,
  });
}

function createEffectControl(
  map: Image,
  type: WeatherEffectType,
  label: string,
  icon: string
): HTMLElement {
  const weather = getWeather(map);

  const settings = getEffectSettings(
    weather,
    type
  );

  const wrapper =
    document.createElement("div");

  wrapper.className = "effect-wrapper";

  if (settings.enabled) {
    wrapper.classList.add("effect-enabled");
  }

  const button =
    document.createElement("button");

  button.className = "effect-button";

  if (settings.enabled) {
    button.classList.add("active");
  }

  button.type = "button";

  button.setAttribute(
    "aria-pressed",
    String(settings.enabled)
  );

  const effectIcon =
    document.createElement("span");

  effectIcon.className = "effect-icon";
  effectIcon.textContent = icon;

  const effectName =
    document.createElement("span");

  effectName.className = "effect-name";
  effectName.textContent = label;

  const check =
    document.createElement("span");

  check.className = "effect-check";
  check.textContent = settings.enabled
    ? "✓"
    : "";

  button.append(
    effectIcon,
    effectName,
    check
  );

  button.addEventListener(
    "click",
    async () => {
      await toggleEffect(map.id, type);
    }
  );

  wrapper.appendChild(button);

  if (settings.enabled) {
    const intensityRow =
      document.createElement("div");

    intensityRow.className =
      "effect-intensity";

    const intensityHeader =
      document.createElement("div");

    intensityHeader.className =
      "intensity-header";

    const intensityLabel =
      document.createElement("span");

    intensityLabel.textContent =
      "Intensity";

    const intensityValue =
      document.createElement("span");

    intensityValue.className =
      "intensity-value";

    intensityValue.textContent =
      `${Math.round(
        settings.intensity * 100
      )}%`;

    intensityHeader.append(
      intensityLabel,
      intensityValue
    );

    const slider =
      document.createElement("input");

    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "5";

    slider.value = String(
      Math.round(
        settings.intensity * 100
      )
    );

    /*
     * Update the number immediately while dragging.
     * We only write to Owlbear when the drag ends.
     */
    slider.addEventListener(
      "input",
      () => {
        intensityValue.textContent =
          `${slider.value}%`;
      }
    );

    slider.addEventListener(
      "change",
      async () => {
        await setIntensity(
          map.id,
          type,
          Number(slider.value) / 100
        );
      }
    );

    intensityRow.append(
      intensityHeader,
      slider
    );

    wrapper.appendChild(intensityRow);
  }

  return wrapper;
}

function createMapCard(
  map: Image
): HTMLElement {
  const weather = getWeather(map);

  const activeEffects =
    getActiveEffects(weather);

  const active =
    activeEffects.length > 0;

  const expanded =
    expandedMaps.has(map.id);

  const card =
    document.createElement("article");

  card.className = "map-card";

  if (active) {
    card.classList.add(
      "weather-active"
    );
  }

  if (expanded) {
    card.classList.add("expanded");
  }

  const header =
    document.createElement("button");

  header.className = "map-header";
  header.type = "button";

  header.setAttribute(
    "aria-expanded",
    String(expanded)
  );

  const chevron =
    document.createElement("span");

  chevron.className = "chevron";
  chevron.textContent = expanded
    ? "▾"
    : "▸";

  const mapIcon =
    document.createElement("span");

  mapIcon.className = "map-icon";
  mapIcon.textContent = "▧";

  const text =
    document.createElement("div");

  text.className = "map-text";

  const name =
    document.createElement("div");

  name.className = "map-name";
  name.textContent = getMapName(map);
  name.title = getMapName(map);

  const summary =
    document.createElement("div");

  summary.className = "map-state";
  summary.textContent =
    getWeatherSummary(map);

  text.append(name, summary);

  const badge =
    document.createElement("span");

  badge.className =
    activeEffects.length > 0
      ? "effect-count active"
      : "effect-count";

  badge.textContent =
    String(activeEffects.length);

  header.append(
    chevron,
    mapIcon,
    text,
    badge
  );

  header.addEventListener(
    "click",
    async () => {
      if (expandedMaps.has(map.id)) {
        expandedMaps.delete(map.id);
      } else {
        expandedMaps.add(map.id);
      }

      await render();
    }
  );

  card.appendChild(header);

  if (expanded) {
    const body =
      document.createElement("div");

    body.className = "map-body";

    const label =
      document.createElement("div");

    label.className = "effects-label";
    label.textContent =
      "Weather effects";

    const effects =
      document.createElement("div");

    effects.className = "effects-list";

    for (const effect of EFFECTS) {
      effects.appendChild(
        createEffectControl(
          map,
          effect.type,
          effect.label,
          effect.icon
        )
      );
    }

    body.append(label, effects);

    card.appendChild(body);
  }

  return card;
}

async function render(): Promise<void> {
  const root =
    document.querySelector<HTMLDivElement>(
      "#app"
    );

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
            ${maps.length === 1
              ? "map"
              : "maps"}
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
              <div class="empty-icon">
                ▧
              </div>

              <p>No map images found.</p>

              <span>
                Add an image to Owlbear's
                Map layer and it will
                appear here.
              </span>
            </div>
          `
          : ""
      }

      <footer class="footer">
        Weather settings are stored.
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
      list.appendChild(
        createMapCard(map)
      );
    }
  }
}

OBR.onReady(async () => {
  await render();

  OBR.scene.items.onChange(
    async () => {
      await render();
    }
  );

  OBR.scene.onReadyChange(
    async (ready) => {
      if (ready) {
        await render();
      }
    }
  );
});
