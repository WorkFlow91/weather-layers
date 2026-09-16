import OBR, {
  Image,
  buildEffect,
  isImage,
} from "@owlbear-rodeo/sdk";

import "./style.css";

const METADATA_KEY = "weather-layers/weather";
const LOCAL_EFFECT_KEY =
  "weather-layers/local-effect";

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
  effects: Partial<
    Record<WeatherEffectType, EffectSettings>
  >;
};

type LegacyWeatherMetadata = {
  type?: "NONE" | "RAIN" | "STORM" | "FOG";
  enabled?: boolean;
  intensity?: number;
};

type LocalEffectMetadata = {
  mapId: string;
  effectType: WeatherEffectType;
  intensity: number;
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

const expandedMaps = new Set<string>();

/*
 * First real post-processing shader.
 *
 * This samples the already-rendered scene and adds animated
 * vertical rain streaks on top.
 *
 * intensity is passed from our UI as a custom uniform.
 */
const RAIN_SHADER = `
uniform shader scene;

uniform vec2 size;
uniform float time;
uniform mat3 modelView;

uniform float intensity;

float hash(float n) {
  return fract(sin(n * 91.3458) * 47453.5453);
}

float rainLayer(
  vec2 uv,
  float columns,
  float speed,
  float seed
) {
  float x = uv.x * columns;

  float column = floor(x);
  float columnPosition = fract(x);

  float randomA =
    hash(column + seed);

  float randomB =
    hash(column * 3.17 + seed);

  /*
   * Slightly offset each streak within its column.
   */
  float center =
    0.2 + randomA * 0.6;

  float horizontalDistance =
    abs(columnPosition - center);

  /*
   * Thin vertical streak.
   */
  float width =
    mix(
      0.035,
      0.012,
      randomB
    );

  float line =
    1.0 -
    smoothstep(
      width,
      width * 2.5,
      horizontalDistance
    );

  /*
   * Repeating segments travelling downward.
   */
  float y =
    uv.y * 8.0
    - time *
      speed *
      (0.75 + randomA * 0.7)
    + randomB * 10.0;

  float segment =
    fract(y);

  /*
   * Long streak followed by empty space.
   */
  float streak =
    1.0 -
    smoothstep(
      0.20,
      0.48,
      abs(segment - 0.5)
    );

  /*
   * Some columns get suppressed, avoiding
   * an overly uniform curtain of rain.
   */
  float visibility =
    step(
      0.28,
      hash(column * 5.91 + seed)
    );

  return line * streak * visibility;
}

half4 main(float2 coord) {
  /*
   * Convert local effect coordinates into screen-space
   * coordinates so we can sample the scene beneath.
   */
  vec2 sceneCoord =
    (vec3(coord, 1.0) * modelView).xy;

  half4 base =
    scene.eval(sceneCoord);

  vec2 uv =
    coord / size;

  /*
   * Correct horizontal density for very wide maps.
   */
  float aspect =
    size.x /
    max(size.y, 1.0);

  vec2 rainUv = uv;

  rainUv.x *= aspect;

  /*
   * Multiple layers make the motion feel less mechanical.
   */
  float rainA =
    rainLayer(
      rainUv,
      38.0,
      1.8,
      1.0
    );

  float rainB =
    rainLayer(
      rainUv + vec2(0.13, 0.0),
      55.0,
      2.5,
      19.0
    );

  float rainC =
    rainLayer(
      rainUv + vec2(0.31, 0.0),
      75.0,
      3.2,
      47.0
    );

  float rain =
    rainA * 0.55 +
    rainB * 0.35 +
    rainC * 0.20;

  /*
   * Intensity affects both density/visibility and brightness.
   */
  rain *=
    mix(
      0.25,
      1.15,
      intensity
    );

  rain =
    clamp(
      rain,
      0.0,
      1.0
    );

  half3 rainColor =
    half3(
      0.72,
      0.82,
      0.92
    );

  half rainAlpha =
    half(
      rain *
      mix(
        0.18,
        0.65,
        intensity
      )
    );

  half3 result =
    mix(
      base.rgb,
      rainColor,
      rainAlpha
    );

  return half4(
    result,
    base.a
  );
}
`;

function getDefaultEffectSettings(): EffectSettings {
  return {
    enabled: false,
    intensity: 0.6,
  };
}

function getWeather(
  item: Image
): WeatherMetadata {
  const raw =
    item.metadata[METADATA_KEY];

  if (
    raw &&
    typeof raw === "object" &&
    "version" in raw &&
    (raw as WeatherMetadata).version === 2
  ) {
    return raw as WeatherMetadata;
  }

  const legacy =
    raw as LegacyWeatherMetadata | undefined;

  const effects:
    WeatherMetadata["effects"] = {};

  if (
    legacy?.type &&
    legacy.type !== "NONE"
  ) {
    const intensity =
      typeof legacy.intensity ===
      "number"
        ? legacy.intensity
        : 0.6;

    const enabled =
      legacy.enabled ?? true;

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

function getMapName(
  item: Image
): string {
  const name =
    item.name?.trim();

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

function hasActiveWeather(
  item: Image
): boolean {
  return (
    getActiveEffects(
      getWeather(item)
    ).length > 0
  );
}

function getWeatherSummary(
  item: Image
): string {
  const weather =
    getWeather(item);

  const active =
    getActiveEffects(weather);

  if (active.length === 0) {
    return "No active effects";
  }

  const labels =
    active.map((type) => {
      return (
        EFFECTS.find(
          (effect) =>
            effect.type === type
        )?.label ?? type
      );
    });

  return labels.join(", ");
}

async function getMaps(): Promise<
  Image[]
> {
  const maps =
    await OBR.scene.items.getItems(
      (item): item is Image =>
        item.layer === "MAP" &&
        isImage(item)
    );

  return sortMaps(maps);
}

function sortMaps(
  maps: Image[]
): Image[] {
  const result = [...maps];

  result.sort((a, b) => {
    const activeA =
      hasActiveWeather(a);

    const activeB =
      hasActiveWeather(b);

    switch (sortMode) {
      case "NAME_DESC":
        return getMapName(
          b
        ).localeCompare(
          getMapName(a)
        );

      case "ACTIVE_FIRST": {
        const difference =
          Number(activeB) -
          Number(activeA);

        if (difference !== 0) {
          return difference;
        }

        return getMapName(
          a
        ).localeCompare(
          getMapName(b)
        );
      }

      case "INACTIVE_FIRST": {
        const difference =
          Number(activeA) -
          Number(activeB);

        if (difference !== 0) {
          return difference;
        }

        return getMapName(
          a
        ).localeCompare(
          getMapName(b)
        );
      }

      case "NAME_ASC":
      default:
        return getMapName(
          a
        ).localeCompare(
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

        const weather =
          getWeather(item);

        const previous =
          getEffectSettings(
            weather,
            type
          );

        const nextWeather:
          WeatherMetadata = {
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
    await OBR.scene.items.getItems(
      [mapId]
    );

  if (items.length === 0) {
    return;
  }

  const item = items[0];

  if (!isImage(item)) {
    return;
  }

  const weather =
    getWeather(item);

  const settings =
    getEffectSettings(
      weather,
      type
    );

  await updateEffect(
    mapId,
    type,
    {
      enabled:
        !settings.enabled,
    }
  );
}

async function setIntensity(
  mapId: string,
  type: WeatherEffectType,
  intensity: number
): Promise<void> {
  await updateEffect(
    mapId,
    type,
    {
      intensity,
    }
  );
}

/*
 * -----------------------------
 * LOCAL POST-PROCESS MANAGEMENT
 * -----------------------------
 *
 * Effects are local-only in Owlbear, so every client creates
 * its own Effect item from the shared map metadata.
 *
 * Owlbear documents Effect items as experimental and local-only.
 */
async function syncRainEffects(
  maps: Image[]
): Promise<void> {
  const localEffects =
    await OBR.scene.local.getItems(
      (item) =>
        item.type === "EFFECT" &&
        Boolean(
          item.metadata[
            LOCAL_EFFECT_KEY
          ]
        )
    );

  const rainByMap =
    new Map<
      string,
      {
        id: string;
        intensity: number;
      }
    >();

  /*
   * Find Rain Effects that this extension already created.
   */
  for (
    const item of localEffects
  ) {
    const metadata =
      item.metadata[
        LOCAL_EFFECT_KEY
      ] as
        | LocalEffectMetadata
        | undefined;

    if (
      !metadata ||
      metadata.effectType !==
        "RAIN"
    ) {
      continue;
    }

    rainByMap.set(
      metadata.mapId,
      {
        id: item.id,
        intensity:
          metadata.intensity,
      }
    );
  }

  const wantedMapIds =
    new Set<string>();

  for (const map of maps) {
    const weather =
      getWeather(map);

    const rain =
      getEffectSettings(
        weather,
        "RAIN"
      );

    if (!rain.enabled) {
      continue;
    }

    wantedMapIds.add(map.id);

    const existing =
      rainByMap.get(map.id);

    /*
     * If the existing Effect already has the correct
     * intensity, leave it alone.
     */
    if (
      existing &&
      Math.abs(
        existing.intensity -
          rain.intensity
      ) < 0.001
    ) {
      continue;
    }

    /*
     * Intensity changed:
     * remove the old local shader and recreate it.
     *
     * For our first test this keeps the synchronization
     * logic simple and predictable.
     */
    if (existing) {
      await OBR.scene.local.deleteItems(
        [existing.id]
      );
    }

    const effect =
      buildEffect()
        .name(
          `Weather Layers: Rain`
        )
        .effectType(
          "ATTACHMENT"
        )
        .attachedTo(map.id)
        .layer(
          "POST_PROCESS"
        )
        .locked(true)
        .disableHit(true)
        .metadata({
          [LOCAL_EFFECT_KEY]: {
            mapId: map.id,
            effectType:
              "RAIN",
            intensity:
              rain.intensity,
          } satisfies LocalEffectMetadata,
        })
        .uniforms([
          {
            name: "intensity",
            value:
              rain.intensity,
          },
        ])
        .sksl(RAIN_SHADER)
        .build();

    await OBR.scene.local.addItems(
      [effect]
    );
  }

  /*
   * Remove rain effects whose source map no longer
   * has Rain enabled.
   */
  for (
    const [
      mapId,
      local,
    ] of rainByMap
  ) {
    if (
      !wantedMapIds.has(mapId)
    ) {
      await OBR.scene.local.deleteItems(
        [local.id]
      );
    }
  }
}

async function syncWeatherRendering(): Promise<void> {
  const maps =
    await getMaps();

  await syncRainEffects(maps);
}

function createEffectControl(
  map: Image,
  type: WeatherEffectType,
  label: string,
  icon: string
): HTMLElement {
  const weather =
    getWeather(map);

  const settings =
    getEffectSettings(
      weather,
      type
    );

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.className =
    "effect-wrapper";

  if (settings.enabled) {
    wrapper.classList.add(
      "effect-enabled"
    );
  }

  const button =
    document.createElement(
      "button"
    );

  button.className =
    "effect-button";

  if (settings.enabled) {
    button.classList.add(
      "active"
    );
  }

  button.type = "button";

  button.setAttribute(
    "aria-pressed",
    String(settings.enabled)
  );

  const effectIcon =
    document.createElement(
      "span"
    );

  effectIcon.className =
    "effect-icon";

  effectIcon.textContent =
    icon;

  const effectName =
    document.createElement(
      "span"
    );

  effectName.className =
    "effect-name";

  effectName.textContent =
    label;

  const check =
    document.createElement(
      "span"
    );

  check.className =
    "effect-check";

  check.textContent =
    settings.enabled
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
      await toggleEffect(
        map.id,
        type
      );
    }
  );

  wrapper.appendChild(button);

  if (settings.enabled) {
    const intensityRow =
      document.createElement(
        "div"
      );

    intensityRow.className =
      "effect-intensity";

    const intensityHeader =
      document.createElement(
        "div"
      );

    intensityHeader.className =
      "intensity-header";

    const intensityLabel =
      document.createElement(
        "span"
      );

    intensityLabel.textContent =
      "Intensity";

    const intensityValue =
      document.createElement(
        "span"
      );

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
      document.createElement(
        "input"
      );

    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "5";

    slider.value =
      String(
        Math.round(
          settings.intensity *
            100
        )
      );

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
          Number(
            slider.value
          ) / 100
        );
      }
    );

    intensityRow.append(
      intensityHeader,
      slider
    );

    wrapper.appendChild(
      intensityRow
    );
  }

  return wrapper;
}

function createMapCard(
  map: Image
): HTMLElement {
  const weather =
    getWeather(map);

  const activeEffects =
    getActiveEffects(weather);

  const active =
    activeEffects.length > 0;

  const expanded =
    expandedMaps.has(map.id);

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "map-card";

  if (active) {
    card.classList.add(
      "weather-active"
    );
  }

  if (expanded) {
    card.classList.add(
      "expanded"
    );
  }

  const header =
    document.createElement(
      "button"
    );

  header.className =
    "map-header";

  header.type = "button";

  header.setAttribute(
    "aria-expanded",
    String(expanded)
  );

  const chevron =
    document.createElement(
      "span"
    );

  chevron.className =
    "chevron";

  chevron.textContent =
    expanded
      ? "▾"
      : "▸";

  const mapIcon =
    document.createElement(
      "span"
    );

  mapIcon.className =
    "map-icon";

  mapIcon.textContent =
    "▧";

  const text =
    document.createElement(
      "div"
    );

  text.className =
    "map-text";

  const name =
    document.createElement(
      "div"
    );

  name.className =
    "map-name";

  name.textContent =
    getMapName(map);

  name.title =
    getMapName(map);

  const summary =
    document.createElement(
      "div"
    );

  summary.className =
    "map-state";

  summary.textContent =
    getWeatherSummary(map);

  text.append(
    name,
    summary
  );

  const badge =
    document.createElement(
      "span"
    );

  badge.className =
    activeEffects.length > 0
      ? "effect-count active"
      : "effect-count";

  badge.textContent =
    String(
      activeEffects.length
    );

  header.append(
    chevron,
    mapIcon,
    text,
    badge
  );

  header.addEventListener(
    "click",
    async () => {
      if (
        expandedMaps.has(
          map.id
        )
      ) {
        expandedMaps.delete(
          map.id
        );
      } else {
        expandedMaps.add(
          map.id
        );
      }

      await render();
    }
  );

  card.appendChild(header);

  if (expanded) {
    const body =
      document.createElement(
        "div"
      );

    body.className =
      "map-body";

    const label =
      document.createElement(
        "div"
      );

    label.className =
      "effects-label";

    label.textContent =
      "Weather effects";

    const effects =
      document.createElement(
        "div"
      );

    effects.className =
      "effects-list";

    for (
      const effect of EFFECTS
    ) {
      effects.appendChild(
        createEffectControl(
          map,
          effect.type,
          effect.label,
          effect.icon
        )
      );
    }

    body.append(
      label,
      effects
    );

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

  const maps =
    await getMaps();

  root.innerHTML = `
    <main class="panel">
      <header class="header">
        <div>
          <h1>
            Weather Layers
          </h1>

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
            ${
              maps.length === 1
                ? "map"
                : "maps"
            }
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

              <p>
                No map images found.
              </p>

              <span>
                Add an image to
                Owlbear's Map layer
                and it will appear
                here.
              </span>
            </div>
          `
          : ""
      }

      <footer class="footer">
        Rain rendering enabled.
        Other effects are still
        placeholders.
      </footer>
    </main>
  `;

  const sortSelect =
    document.querySelector<HTMLSelectElement>(
      "#sort-select"
    );

  if (sortSelect) {
    sortSelect.value =
      sortMode;

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
    for (
      const map of maps
    ) {
      list.appendChild(
        createMapCard(map)
      );
    }
  }
}

async function refreshEverything(): Promise<void> {
  await syncWeatherRendering();
  await render();
}

OBR.onReady(async () => {
  await refreshEverything();

  OBR.scene.items.onChange(
    async () => {
      await refreshEverything();
    }
  );

  OBR.scene.onReadyChange(
    async (ready) => {
      if (ready) {
        await refreshEverything();
      }
    }
  );
});
