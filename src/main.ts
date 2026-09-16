import OBR, {
  buildImage,
  isImage,
} from "@owlbear-rodeo/sdk";

import type {
  Image,
  ImageDownload,
} from "@owlbear-rodeo/sdk";

import "./style.css";

const WEATHER_KEY =
  "weather-layers/weather";

const ASSET_LIBRARY_KEY =
  "weather-layers/assets";

const OVERLAY_KEY =
  "weather-layers/overlay";

type WeatherEffectType =
  | "CLOUDS"
  | "RAIN"
  | "SNOW"
  | "FOG"
  | "LIGHTNING";

type EffectSettings = {
  enabled: boolean;
};

type WeatherMetadata = {
  version: 3;
  effects: Partial<
    Record<
      WeatherEffectType,
      EffectSettings
    >
  >;
};

type OldWeatherMetadata = {
  version?: number;
  effects?: Partial<
    Record<
      WeatherEffectType,
      {
        enabled?: boolean;
        intensity?: number;
      }
    >
  >;
  type?:
    | "NONE"
    | "RAIN"
    | "STORM"
    | "FOG";
  enabled?: boolean;
  intensity?: number;
};

type StoredAsset = {
  name: string;

  image: ImageDownload["image"];
  grid: ImageDownload["grid"];
};

type AssetLibrary = Partial<
  Record<
    WeatherEffectType,
    StoredAsset
  >
>;

type OverlayMetadata = {
  version: 1;
  mapId: string;
  effectType: WeatherEffectType;

  assetUrl: string;
  mapImageUrl: string;
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

let sortMode: SortMode =
  "NAME_ASC";

const expandedMaps =
  new Set<string>();

let assetsExpanded = true;

/*
 * Prevent scene-change events caused by our own
 * synchronization from starting overlapping refreshes.
 */
let refreshing = false;
let refreshAgain = false;


/* ---------------------------------
   WEATHER DATA
---------------------------------- */

function getWeather(
  item: Image
): WeatherMetadata {
  const raw =
    item.metadata[
      WEATHER_KEY
    ] as
      | OldWeatherMetadata
      | undefined;

  if (
    raw?.version === 3 &&
    raw.effects
  ) {
    return raw as WeatherMetadata;
  }

  const effects:
    WeatherMetadata["effects"] = {};

  /*
   * Migrate our previous multi-effect
   * format automatically.
   */
  if (raw?.effects) {
    for (const effect of EFFECTS) {
      const old =
        raw.effects[
          effect.type
        ];

      if (old) {
        effects[
          effect.type
        ] = {
          enabled:
            old.enabled ??
            false,
        };
      }
    }
  }

  /*
   * Also support the first,
   * single-weather version.
   */
  if (
    raw?.type &&
    raw.type !== "NONE"
  ) {
    const enabled =
      raw.enabled ?? true;

    if (raw.type === "RAIN") {
      effects.RAIN = {
        enabled,
      };
    }

    if (raw.type === "FOG") {
      effects.FOG = {
        enabled,
      };
    }

    if (raw.type === "STORM") {
      effects.CLOUDS = {
        enabled,
      };

      effects.RAIN = {
        enabled,
      };
    }
  }

  return {
    version: 3,
    effects,
  };
}

function getEffectSettings(
  weather: WeatherMetadata,
  type: WeatherEffectType
): EffectSettings {
  return (
    weather.effects[type] ?? {
      enabled: false,
    }
  );
}

async function setEffectEnabled(
  mapId: string,
  type: WeatherEffectType,
  enabled: boolean
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

        item.metadata[
          WEATHER_KEY
        ] = {
          version: 3,

          effects: {
            ...weather.effects,

            [type]: {
              enabled,
            },
          },
        } satisfies WeatherMetadata;
      }
    }
  );
}


/* ---------------------------------
   WEATHER ASSET LIBRARY
---------------------------------- */

async function getAssetLibrary():
  Promise<AssetLibrary> {
  const metadata =
    await OBR.scene.getMetadata();

  return (
    metadata[
      ASSET_LIBRARY_KEY
    ] as
      | AssetLibrary
      | undefined
  ) ?? {};
}

async function chooseAsset(
  type: WeatherEffectType
): Promise<void> {
  /*
   * This opens Owlbear's native asset picker.
   *
   * false = choose one image only.
   *
   * We deliberately don't provide a type hint,
   * so you aren't restricted to images uploaded
   * specifically as ATTACHMENT assets.
   */
  const images =
    await OBR.assets.downloadImages(
      false,
      ""
    );

  if (images.length === 0) {
    return;
  }

  const selected =
    images[0];

  const library =
    await getAssetLibrary();

  const updated:
    AssetLibrary = {
    ...library,

    [type]: {
      name: selected.name,
      image: selected.image,
      grid: selected.grid,
    },
  };

  await OBR.scene.setMetadata({
    [ASSET_LIBRARY_KEY]:
      updated,
  });
}

async function clearAsset(
  type: WeatherEffectType
): Promise<void> {
  const library =
    await getAssetLibrary();

  const updated = {
    ...library,
  };

  delete updated[type];

  await OBR.scene.setMetadata({
    [ASSET_LIBRARY_KEY]:
      updated,
  });
}


/* ---------------------------------
   MAP DISCOVERY
---------------------------------- */

function getMapName(
  item: Image
): string {
  return (
    item.name?.trim() ||
    "Unnamed Map"
  );
}

function getActiveEffects(
  item: Image
): WeatherEffectType[] {
  const weather =
    getWeather(item);

  return EFFECTS
    .filter((effect) => {
      return getEffectSettings(
        weather,
        effect.type
      ).enabled;
    })
    .map(
      (effect) =>
        effect.type
    );
}

function getWeatherSummary(
  item: Image
): string {
  const active =
    getActiveEffects(item);

  if (active.length === 0) {
    return "No active effects";
  }

  return active
    .map((type) => {
      return (
        EFFECTS.find(
          (effect) =>
            effect.type ===
            type
        )?.label ?? type
      );
    })
    .join(", ");
}

async function getMaps():
  Promise<Image[]> {
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
      getActiveEffects(a)
        .length > 0;

    const activeB =
      getActiveEffects(b)
        .length > 0;

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


/* ---------------------------------
   STATIC OVERLAY SYNCHRONIZATION
---------------------------------- */

function overlayKey(
  mapId: string,
  type: WeatherEffectType
): string {
  return `${mapId}:${type}`;
}

function calculateOverlayScale(
  map: Image,
  asset: StoredAsset
) {
  /*
   * Fit the selected weather image exactly
   * to the rendered dimensions of the map.
   *
   * This intentionally stretches the weather
   * image to fill the map.
   */
  return {
    x:
      map.scale.x *
      (
        map.image.width /
        asset.image.width
      ),

    y:
      map.scale.y *
      (
        map.image.height /
        asset.image.height
      ),
  };
}

async function createOverlay(
  map: Image,
  type: WeatherEffectType,
  asset: StoredAsset
): Promise<void> {
  const effect =
    EFFECTS.find(
      (entry) =>
        entry.type === type
    );

  const overlay =
    buildImage(
      asset.image,
      asset.grid
    )
      .name(
        `Weather: ${
          effect?.label ?? type
        } — ${getMapName(map)}`
      )

      /*
       * Start with the same transform
       * as the target map.
       */
      .position({
        ...map.position,
      })

      .rotation(
        map.rotation
      )

      .scale(
        calculateOverlayScale(
          map,
          asset
        )
      )

      /*
       * ATTACHMENT causes future movement,
       * rotation, scaling, visibility and
       * deletion of the map to propagate
       * to the overlay.
       */
      .layer("ATTACHMENT")
      .attachedTo(map.id)

      /*
       * Weather must never intercept
       * canvas selection.
       */
      .locked(true)
      .disableHit(true)

      .metadata({
        [OVERLAY_KEY]: {
          version: 1,
          mapId: map.id,
          effectType: type,
          assetUrl:
            asset.image.url,
          mapImageUrl:
            map.image.url,
        } satisfies OverlayMetadata,
      })

      .build();

  await OBR.scene.items.addItems(
    [overlay]
  );
}

async function syncOverlays():
  Promise<void> {
  const maps =
    await getMaps();

  const library =
    await getAssetLibrary();

  const overlays =
    await OBR.scene.items.getItems(
      (item) =>
        Boolean(
          item.metadata[
            OVERLAY_KEY
          ]
        )
    );

  const existing =
    new Map<
      string,
      Array<{
        id: string;
        metadata:
          OverlayMetadata;
      }>
    >();

  for (const item of overlays) {
    const metadata =
      item.metadata[
        OVERLAY_KEY
      ] as
        | OverlayMetadata
        | undefined;

    if (!metadata) {
      continue;
    }

    const key =
      overlayKey(
        metadata.mapId,
        metadata.effectType
      );

    const list =
      existing.get(key) ?? [];

    list.push({
      id: item.id,
      metadata,
    });

    existing.set(
      key,
      list
    );
  }

  const wanted =
    new Set<string>();

  for (const map of maps) {
    const weather =
      getWeather(map);

    for (
      const effect of EFFECTS
    ) {
      const settings =
        getEffectSettings(
          weather,
          effect.type
        );

      const asset =
        library[
          effect.type
        ];

      /*
       * If an effect isn't enabled,
       * or no Owlbear asset has been
       * assigned to it, it should not
       * have an overlay.
       */
      if (
        !settings.enabled ||
        !asset
      ) {
        continue;
      }

      const key =
        overlayKey(
          map.id,
          effect.type
        );

      wanted.add(key);

      const matches =
        existing.get(key) ??
        [];

      const valid =
        matches.find(
          (entry) =>
            entry.metadata
              .assetUrl ===
              asset.image.url &&
            entry.metadata
              .mapImageUrl ===
              map.image.url
        );

      /*
       * Correct overlay already exists.
       */
      if (valid) {
        /*
         * Remove accidental duplicates.
         */
        const duplicates =
          matches.filter(
            (entry) =>
              entry.id !==
              valid.id
          );

        if (
          duplicates.length > 0
        ) {
          await OBR.scene.items
            .deleteItems(
              duplicates.map(
                (entry) =>
                  entry.id
              )
            );
        }

        continue;
      }

      /*
       * Wrong/old asset:
       * remove it and recreate.
       */
      if (
        matches.length > 0
      ) {
        await OBR.scene.items
          .deleteItems(
            matches.map(
              (entry) =>
                entry.id
            )
          );
      }

      await createOverlay(
        map,
        effect.type,
        asset
      );
    }
  }

  /*
   * Delete overlays that are no
   * longer wanted at all.
   */
  for (
    const [key, items]
    of existing
  ) {
    if (
      wanted.has(key)
    ) {
      continue;
    }

    await OBR.scene.items
      .deleteItems(
        items.map(
          (item) =>
            item.id
        )
      );
  }
}


/* ---------------------------------
   UI: ASSET LIBRARY
---------------------------------- */

function createAssetRow(
  type: WeatherEffectType,
  label: string,
  icon: string,
  asset?: StoredAsset
): HTMLElement {
  const row =
    document.createElement(
      "div"
    );

  row.className =
    "asset-row";

  const info =
    document.createElement(
      "div"
    );

  info.className =
    "asset-info";

  const assetIcon =
    document.createElement(
      "div"
    );

  assetIcon.className =
    "asset-icon";

  assetIcon.textContent =
    icon;

  const text =
    document.createElement(
      "div"
    );

  text.className =
    "asset-text";

  const title =
    document.createElement(
      "div"
    );

  title.className =
    "asset-title";

  title.textContent =
    label;

  const filename =
    document.createElement(
      "div"
    );

  filename.className =
    asset
      ? "asset-filename"
      : "asset-filename missing";

  filename.textContent =
    asset?.name ??
    "No asset selected";

  text.append(
    title,
    filename
  );

  info.append(
    assetIcon,
    text
  );

  const controls =
    document.createElement(
      "div"
    );

  controls.className =
    "asset-controls";

  const choose =
    document.createElement(
      "button"
    );

  choose.className =
    "small-button";

  choose.type = "button";

  choose.textContent =
    asset
      ? "Change"
      : "Choose";

  choose.addEventListener(
    "click",
    async () => {
      await chooseAsset(type);
    }
  );

  controls.appendChild(
    choose
  );

  if (asset) {
    const clear =
      document.createElement(
        "button"
      );

    clear.className =
      "small-button danger";

    clear.type = "button";
    clear.title =
      "Clear asset";

    clear.textContent =
      "×";

    clear.addEventListener(
      "click",
      async () => {
        await clearAsset(type);
      }
    );

    controls.appendChild(
      clear
    );
  }

  row.append(
    info,
    controls
  );

  return row;
}


/* ---------------------------------
   UI: MAP EFFECTS
---------------------------------- */

function createEffectControl(
  map: Image,
  type: WeatherEffectType,
  label: string,
  icon: string,
  asset?: StoredAsset
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

  if (!asset) {
    wrapper.classList.add(
      "effect-unavailable"
    );
  }

  const button =
    document.createElement(
      "button"
    );

  button.className =
    "effect-button";

  button.type = "button";

  /*
   * Don't enable an effect until an
   * image has been chosen for it.
   */
  button.disabled = !asset;

  const effectIcon =
    document.createElement(
      "span"
    );

  effectIcon.className =
    "effect-icon";

  effectIcon.textContent =
    icon;

  const nameBlock =
    document.createElement(
      "span"
    );

  nameBlock.className =
    "effect-name-block";

  const effectName =
    document.createElement(
      "span"
    );

  effectName.className =
    "effect-name";

  effectName.textContent =
    label;

  const assetName =
    document.createElement(
      "span"
    );

  assetName.className =
    "effect-asset-name";

  assetName.textContent =
    asset
      ? asset.name
      : "Choose an asset above";

  nameBlock.append(
    effectName,
    assetName
  );

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

  if (settings.enabled) {
    button.classList.add(
      "active"
    );
  }

  button.append(
    effectIcon,
    nameBlock,
    check
  );

  button.addEventListener(
    "click",
    async () => {
      await setEffectEnabled(
        map.id,
        type,
        !settings.enabled
      );
    }
  );

  wrapper.appendChild(
    button
  );

  return wrapper;
}

function createMapCard(
  map: Image,
  library: AssetLibrary
): HTMLElement {
  const activeEffects =
    getActiveEffects(map);

  const expanded =
    expandedMaps.has(
      map.id
    );

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "map-card";

  if (
    activeEffects.length >
    0
  ) {
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

  card.appendChild(
    header
  );

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
          effect.icon,
          library[
            effect.type
          ]
        )
      );
    }

    body.append(
      label,
      effects
    );

    card.appendChild(
      body
    );
  }

  return card;
}


/* ---------------------------------
   MAIN RENDER
---------------------------------- */

async function render():
  Promise<void> {
  const root =
    document.querySelector<HTMLDivElement>(
      "#app"
    );

  if (!root) {
    return;
  }

  const maps =
    await getMaps();

  const library =
    await getAssetLibrary();

  root.innerHTML = `
    <main class="panel">

      <header class="header">
        <div>
          <h1>
            Weather Layers
          </h1>

          <p class="subtitle">
            Static map-based weather overlays
          </p>
        </div>
      </header>

      <section class="library-section">

        <button
          id="library-header"
          class="section-header-button"
        >
          <span class="section-chevron">
            ${
              assetsExpanded
                ? "▾"
                : "▸"
            }
          </span>

          <span>
            Weather assets
          </span>
        </button>

        <div
          id="asset-list"
          class="asset-list"
        ></div>

      </section>

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

      <footer class="footer">
        Static overlays use images from your
        Owlbear Rodeo asset library.
      </footer>

    </main>
  `;

  const libraryHeader =
    document.querySelector<HTMLButtonElement>(
      "#library-header"
    );

  libraryHeader?.addEventListener(
    "click",
    async () => {
      assetsExpanded =
        !assetsExpanded;

      await render();
    }
  );

  const assetList =
    document.querySelector<HTMLDivElement>(
      "#asset-list"
    );

  if (
    assetList &&
    assetsExpanded
  ) {
    for (
      const effect of EFFECTS
    ) {
      assetList.appendChild(
        createAssetRow(
          effect.type,
          effect.label,
          effect.icon,
          library[
            effect.type
          ]
        )
      );
    }
  }

  if (
    assetList &&
    !assetsExpanded
  ) {
    assetList.style.display =
      "none";
  }

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
          sortSelect.value as
            SortMode;

        await render();
      }
    );
  }

  const mapList =
    document.querySelector<HTMLDivElement>(
      "#map-list"
    );

  if (mapList) {
    for (
      const map of maps
    ) {
      mapList.appendChild(
        createMapCard(
          map,
          library
        )
      );
    }
  }
}


/* ---------------------------------
   REFRESH LOOP
---------------------------------- */

async function requestRefresh():
  Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return;
  }

  do {
    refreshAgain = false;
    refreshing = true;

    try {
      await syncOverlays();
      await render();
    } finally {
      refreshing = false;
    }
  } while (refreshAgain);
}

OBR.onReady(async () => {
  await requestRefresh();

  OBR.scene.items.onChange(
    async () => {
      await requestRefresh();
    }
  );

  OBR.scene.onMetadataChange(
    async () => {
      await requestRefresh();
    }
  );

  OBR.scene.onReadyChange(
    async (ready) => {
      if (ready) {
        await requestRefresh();
      }
    }
  );
});
