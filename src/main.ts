import OBR, {
  Image,
  ImageDownload,
  isImage,
} from "@owlbear-rodeo/sdk";

import "./style.css";

const MAP_WEATHER_KEY =
  "weather-layers/map-weather";

const EFFECT_LIBRARY_KEY =
  "weather-layers/effect-library";

type LinkedAsset = {
  name: string;
  image: ImageDownload["image"];
  grid: ImageDownload["grid"];
};

type EffectDefinition = {
  id: string;
  name: string;
  asset?: LinkedAsset;
};

type EffectLibrary = {
  version: 1;
  effects: EffectDefinition[];
};

type MapEffectSettings = {
  enabled: boolean;
  opacity: number;
};

type MapWeatherMetadata = {
  version: 1;
  effects: Record<
    string,
    MapEffectSettings
  >;
};

type SortMode =
  | "NAME_ASC"
  | "NAME_DESC"
  | "ACTIVE_FIRST"
  | "INACTIVE_FIRST";

const DEFAULT_LIBRARY: EffectLibrary = {
  version: 1,
  effects: [
    {
      id: "rain",
      name: "Rain",
    },
  ],
};

let sortMode: SortMode =
  "NAME_ASC";

let activePanel:
  | "MAPS"
  | "LIBRARY" = "MAPS";

const expandedMaps =
  new Set<string>();


/* --------------------------------
   EFFECT LIBRARY
-------------------------------- */

async function getEffectLibrary():
  Promise<EffectLibrary> {
  const metadata =
    await OBR.room.getMetadata();

  const stored =
    metadata[
      EFFECT_LIBRARY_KEY
    ] as EffectLibrary | undefined;

  if (
    stored?.version === 1 &&
    Array.isArray(stored.effects)
  ) {
    return stored;
  }

  await OBR.room.setMetadata({
    [EFFECT_LIBRARY_KEY]:
      DEFAULT_LIBRARY,
  });

  return DEFAULT_LIBRARY;
}

async function saveEffectLibrary(
  library: EffectLibrary
): Promise<void> {
  await OBR.room.setMetadata({
    [EFFECT_LIBRARY_KEY]:
      library,
  });
}

function createEffectId(
  name: string
): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      ) || "effect";

  return `${base}-${Date.now()}`;
}

async function addEffect():
  Promise<void> {
  const name =
    window.prompt(
      "Name the new weather effect:"
    );

  if (!name?.trim()) {
    return;
  }

  const library =
    await getEffectLibrary();

  const effect:
    EffectDefinition = {
    id: createEffectId(name),
    name: name.trim(),
  };

  await saveEffectLibrary({
    version: 1,
    effects: [
      ...library.effects,
      effect,
    ],
  });
}

async function renameEffect(
  effectId: string
): Promise<void> {
  const library =
    await getEffectLibrary();

  const effect =
    library.effects.find(
      (entry) =>
        entry.id === effectId
    );

  if (!effect) {
    return;
  }

  const name =
    window.prompt(
      "Rename weather effect:",
      effect.name
    );

  if (!name?.trim()) {
    return;
  }

  await saveEffectLibrary({
    version: 1,
    effects:
      library.effects.map(
        (entry) =>
          entry.id === effectId
            ? {
                ...entry,
                name:
                  name.trim(),
              }
            : entry
      ),
  });
}

async function deleteEffect(
  effectId: string
): Promise<void> {
  if (effectId === "rain") {
    await OBR.notification.show(
      "Rain is the default effect and cannot be deleted.",
      "WARNING"
    );

    return;
  }

  const library =
    await getEffectLibrary();

  const effect =
    library.effects.find(
      (entry) =>
        entry.id === effectId
    );

  if (!effect) {
    return;
  }

  const confirmed =
    window.confirm(
      `Delete "${effect.name}"?`
    );

  if (!confirmed) {
    return;
  }

  await saveEffectLibrary({
    version: 1,
    effects:
      library.effects.filter(
        (entry) =>
          entry.id !== effectId
      ),
  });
}

async function linkAsset(
  effectId: string
): Promise<void> {
  const selected =
    await OBR.assets.downloadImages(
      false
    );

  if (
    selected.length === 0
  ) {
    return;
  }

  const picked =
    selected[0];

  const library =
    await getEffectLibrary();

  const effect =
    library.effects.find(
      (entry) =>
        entry.id === effectId
    );

  if (!effect) {
    return;
  }

  const linkedAsset:
    LinkedAsset = {
    name: picked.name,
    image: picked.image,
    grid: picked.grid,
  };

  await saveEffectLibrary({
    version: 1,
    effects:
      library.effects.map(
        (entry) =>
          entry.id === effectId
            ? {
                ...entry,
                asset:
                  linkedAsset,
              }
            : entry
      ),
  });

  await OBR.notification.show(
    `"${picked.name}" linked to ${effect.name}.`,
    "SUCCESS"
  );
}

async function unlinkAsset(
  effectId: string
): Promise<void> {
  const library =
    await getEffectLibrary();

  await saveEffectLibrary({
    version: 1,
    effects:
      library.effects.map(
        (entry) => {
          if (
            entry.id !==
            effectId
          ) {
            return entry;
          }

          const {
            asset,
            ...withoutAsset
          } = entry;

          return withoutAsset;
        }
      ),
  });
}


/* --------------------------------
   MAP WEATHER SETTINGS
-------------------------------- */

function getMapWeather(
  map: Image
): MapWeatherMetadata {
  const stored =
    map.metadata[
      MAP_WEATHER_KEY
    ] as
      | MapWeatherMetadata
      | undefined;

  if (
    stored?.version === 1 &&
    stored.effects
  ) {
    return stored;
  }

  return {
    version: 1,
    effects: {},
  };
}

function getEffectSettings(
  map: Image,
  effectId: string
): MapEffectSettings {
  return (
    getMapWeather(map)
      .effects[
        effectId
      ] ?? {
      enabled: false,
      opacity: 1,
    }
  );
}

async function updateMapEffect(
  mapId: string,
  effectId: string,
  changes:
    Partial<MapEffectSettings>
): Promise<void> {
  await OBR.scene.items.updateItems(
    [mapId],
    (items) => {
      for (const item of items) {
        if (
          !isImage(item)
        ) {
          continue;
        }

        const weather =
          getMapWeather(item);

        const previous =
          weather.effects[
            effectId
          ] ?? {
            enabled: false,
            opacity: 1,
          };

        item.metadata[
          MAP_WEATHER_KEY
        ] = {
          version: 1,
          effects: {
            ...weather.effects,

            [effectId]: {
              ...previous,
              ...changes,
            },
          },
        } satisfies MapWeatherMetadata;
      }
    }
  );
}


/* --------------------------------
   MAP DISCOVERY / SORTING
-------------------------------- */

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

function getMapName(
  map: Image
): string {
  return (
    map.name?.trim() ||
    "Unnamed Map"
  );
}

function getActiveEffectCount(
  map: Image
): number {
  return Object.values(
    getMapWeather(map).effects
  ).filter(
    (settings) =>
      settings.enabled
  ).length;
}

function sortMaps(
  maps: Image[]
): Image[] {
  const sorted = [...maps];

  sorted.sort(
    (a, b) => {
      switch (sortMode) {
        case "NAME_DESC":
          return getMapName(
            b
          ).localeCompare(
            getMapName(a)
          );

        case "ACTIVE_FIRST": {
          const difference =
            getActiveEffectCount(
              b
            ) -
            getActiveEffectCount(
              a
            );

          if (
            difference !== 0
          ) {
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
            getActiveEffectCount(
              a
            ) -
            getActiveEffectCount(
              b
            );

          if (
            difference !== 0
          ) {
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
    }
  );

  return sorted;
}


/* --------------------------------
   UI: MAP PANEL
-------------------------------- */

function createMapEffectRow(
  map: Image,
  effect: EffectDefinition
): HTMLElement {
  const settings =
    getEffectSettings(
      map,
      effect.id
    );

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "map-effect-row";

  if (settings.enabled) {
    row.classList.add(
      "enabled"
    );
  }

  const top =
    document.createElement(
      "div"
    );

  top.className =
    "map-effect-top";

  const toggle =
    document.createElement(
      "button"
    );

  toggle.type = "button";
  toggle.className =
    "effect-toggle";

  if (settings.enabled) {
    toggle.classList.add(
      "active"
    );
  }

  const checkbox =
    document.createElement(
      "span"
    );

  checkbox.className =
    "checkbox";

  checkbox.textContent =
    settings.enabled
      ? "✓"
      : "";

  const label =
    document.createElement(
      "span"
    );

  label.className =
    "effect-label";

  label.textContent =
    effect.name;

  toggle.append(
    checkbox,
    label
  );

  toggle.addEventListener(
    "click",
    async () => {
      await updateMapEffect(
        map.id,
        effect.id,
        {
          enabled:
            !settings.enabled,
        }
      );
    }
  );

  top.appendChild(toggle);

  row.appendChild(top);

  if (settings.enabled) {
    const sliderBlock =
      document.createElement(
        "div"
      );

    sliderBlock.className =
      "opacity-block";

    const sliderHeader =
      document.createElement(
        "div"
      );

    sliderHeader.className =
      "opacity-header";

    const sliderLabel =
      document.createElement(
        "span"
      );

    sliderLabel.textContent =
      "Transparency";

    const sliderValue =
      document.createElement(
        "span"
      );

    sliderValue.className =
      "opacity-value";

    sliderValue.textContent =
      `${Math.round(
        (
          1 -
          settings.opacity
        ) *
          100
      )}%`;

    sliderHeader.append(
      sliderLabel,
      sliderValue
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
          (
            1 -
            settings.opacity
          ) *
            100
        )
      );

    slider.addEventListener(
      "input",
      () => {
        sliderValue.textContent =
          `${slider.value}%`;
      }
    );

    slider.addEventListener(
      "change",
      async () => {
        const transparency =
          Number(
            slider.value
          ) / 100;

        await updateMapEffect(
          map.id,
          effect.id,
          {
            opacity:
              1 -
              transparency,
          }
        );
      }
    );

    sliderBlock.append(
      sliderHeader,
      slider
    );

    row.appendChild(
      sliderBlock
    );
  }

  return row;
}

function createMapCard(
  map: Image,
  library: EffectLibrary
): HTMLElement {
  const expanded =
    expandedMaps.has(
      map.id
    );

  const activeCount =
    getActiveEffectCount(
      map
    );

  const card =
    document.createElement(
      "article"
    );

  card.className =
    "map-card";

  if (
    activeCount > 0
  ) {
    card.classList.add(
      "weather-active"
    );
  }

  const header =
    document.createElement(
      "button"
    );

  header.type = "button";
  header.className =
    "map-header";

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

  const text =
    document.createElement(
      "div"
    );

  text.className =
    "map-header-text";

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
    "map-summary";

  summary.textContent =
    activeCount === 0
      ? "No active effects"
      : `${activeCount} active ${
          activeCount === 1
            ? "effect"
            : "effects"
        }`;

  text.append(
    name,
    summary
  );

  const badge =
    document.createElement(
      "span"
    );

  badge.className =
    "effect-count";

  if (
    activeCount > 0
  ) {
    badge.classList.add(
      "active"
    );
  }

  badge.textContent =
    String(
      activeCount
    );

  header.append(
    chevron,
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

    if (
      library.effects
        .length === 0
    ) {
      body.innerHTML = `
        <div class="empty-inline">
          No weather effects exist yet.
        </div>
      `;
    } else {
      for (
        const effect of
          library.effects
      ) {
        body.appendChild(
          createMapEffectRow(
            map,
            effect
          )
        );
      }
    }

    card.appendChild(body);
  }

  return card;
}


/* --------------------------------
   UI: LIBRARY PANEL
-------------------------------- */

function createLibraryRow(
  effect: EffectDefinition
): HTMLElement {
  const row =
    document.createElement(
      "div"
    );

  row.className =
    "library-row";

  const info =
    document.createElement(
      "div"
    );

  info.className =
    "library-info";

  const name =
    document.createElement(
      "div"
    );

  name.className =
    "library-name";

  name.textContent =
    effect.name;

  const status =
    document.createElement(
      "div"
    );

  status.className =
    effect.asset
      ? "library-status linked"
      : "library-status";

  status.textContent =
    effect.asset
      ? effect.asset.name
      : "No asset linked";

  if (effect.asset) {
    status.title =
      effect.asset.name;
  }

  info.append(
    name,
    status
  );

  const controls =
    document.createElement(
      "div"
    );

  controls.className =
    "library-controls";

  const link =
    document.createElement(
      "button"
    );

  link.type = "button";

  link.className =
    "small-button primary";

  link.textContent =
    effect.asset
      ? "Change"
      : "Link asset";

  link.addEventListener(
    "click",
    async () => {
      await linkAsset(
        effect.id
      );
    }
  );

  const rename =
    document.createElement(
      "button"
    );

  rename.type = "button";
  rename.className =
    "icon-button";

  rename.title =
    "Rename";

  rename.textContent =
    "✎";

  rename.addEventListener(
    "click",
    async () => {
      await renameEffect(
        effect.id
      );
    }
  );

  controls.append(
    link,
    rename
  );

  if (effect.asset) {
    const unlink =
      document.createElement(
        "button"
      );

    unlink.type = "button";

    unlink.className =
      "icon-button";

    unlink.title =
      "Unlink asset";

    unlink.textContent =
      "↗";

    unlink.addEventListener(
      "click",
      async () => {
        await unlinkAsset(
          effect.id
        );
      }
    );

    controls.appendChild(
      unlink
    );
  }

  if (
    effect.id !== "rain"
  ) {
    const remove =
      document.createElement(
        "button"
      );

    remove.type = "button";

    remove.className =
      "icon-button danger";

    remove.title =
      "Delete effect";

    remove.textContent =
      "×";

    remove.addEventListener(
      "click",
      async () => {
        await deleteEffect(
          effect.id
        );
      }
    );

    controls.appendChild(
      remove
    );
  }

  row.append(
    info,
    controls
  );

  return row;
}


/* --------------------------------
   MAIN RENDER
-------------------------------- */

async function render():
  Promise<void> {
  const root =
    document.querySelector<HTMLDivElement>(
      "#app"
    );

  if (!root) {
    return;
  }

  const [
    maps,
    library,
  ] =
    await Promise.all([
      getMaps(),
      getEffectLibrary(),
    ]);

  root.innerHTML = `
    <main class="panel">

      <header class="app-header">
        <div>
          <h1>Weather Layers</h1>

          <p class="subtitle">
            Configure map weather and effect assets
          </p>
        </div>
      </header>

      <nav class="tabs">
        <button
          id="tab-maps"
          class="tab ${
            activePanel ===
            "MAPS"
              ? "active"
              : ""
          }"
        >
          Map Weather
        </button>

        <button
          id="tab-library"
          class="tab ${
            activePanel ===
            "LIBRARY"
              ? "active"
              : ""
          }"
        >
          Effect Library
        </button>
      </nav>

      <section
        id="panel-maps"
        class="${
          activePanel ===
          "MAPS"
            ? ""
            : "hidden"
        }"
      >

        <div class="toolbar">
          <div>
            <div class="section-label">
              Maps in scene
            </div>

            <div class="subtle">
              ${maps.length}
              ${
                maps.length ===
                1
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

        <div
          id="map-list"
          class="map-list"
        ></div>

      </section>

      <section
        id="panel-library"
        class="${
          activePanel ===
          "LIBRARY"
            ? ""
            : "hidden"
        }"
      >

        <div class="panel-heading">
          <div>
            <div class="section-label">
              Weather effects
            </div>

            <div class="subtle">
              Build the list used by every map.
            </div>
          </div>

          <button
            id="add-effect"
            class="add-button"
          >
            + Add effect
          </button>
        </div>

        <div
          id="library-list"
          class="library-list"
        ></div>

      </section>

    </main>
  `;

  document
    .querySelector(
      "#tab-maps"
    )
    ?.addEventListener(
      "click",
      async () => {
        activePanel =
          "MAPS";

        await render();
      }
    );

  document
    .querySelector(
      "#tab-library"
    )
    ?.addEventListener(
      "click",
      async () => {
        activePanel =
          "LIBRARY";

        await render();
      }
    );

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
    if (
      maps.length === 0
    ) {
      mapList.innerHTML = `
        <div class="empty-state">
          No maps found on the MAP layer.
        </div>
      `;
    }

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

  document
    .querySelector(
      "#add-effect"
    )
    ?.addEventListener(
      "click",
      addEffect
    );

  const libraryList =
    document.querySelector<HTMLDivElement>(
      "#library-list"
    );

  if (libraryList) {
    for (
      const effect of
        library.effects
    ) {
      libraryList.appendChild(
        createLibraryRow(
          effect
        )
      );
    }
  }
}


/* --------------------------------
   STARTUP
-------------------------------- */

OBR.onReady(async () => {
  await render();

  OBR.scene.items.onChange(
    async () => {
      await render();
    }
  );

  OBR.room.onMetadataChange(
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
