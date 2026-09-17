import OBR, {
  buildImage,
  Image,
  ImageDownload,
  isImage,
} from "@owlbear-rodeo/sdk";

import "./style.css";

const MAP_WEATHER_KEY =
  "weather-layers/map-weather";

const EFFECT_LIBRARY_KEY =
  "weather-layers/effect-library";

const OVERLAY_KEY =
  "weather-layers/static-overlay";


/* --------------------------------
   TYPES
-------------------------------- */

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

type OverlayMetadata = {
  version: 1;
  mapId: string;
  effectId: string;
  assetUrl: string;
};

type SortMode =
  | "NAME_ASC"
  | "NAME_DESC"
  | "ACTIVE_FIRST"
  | "INACTIVE_FIRST";


/* --------------------------------
   DEFAULT STATE
-------------------------------- */

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
   REFRESH CONTROL
-------------------------------- */

let refreshing = false;
let refreshAgain = false;


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
    Array.isArray(
      stored.effects
    )
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
    id: createEffectId(
      name
    ),
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
          entry.id ===
          effectId
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
  if (
    effectId === "rain"
  ) {
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
          entry.id !==
          effectId
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
          entry.id ===
          effectId
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
      for (
        const item of items
      ) {
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
   MAP DISCOVERY
-------------------------------- */

async function getRawMaps():
  Promise<Image[]> {
  return await OBR.scene.items.getItems(
    (item): item is Image =>
      item.layer ===
        "MAP" &&
      isImage(item)
  );
}

function getMapName(
  map: Image
): string {
  return (
    map.name?.trim() ||
    "Unnamed Map"
  );
}


/* --------------------------------
   ACTIVE EFFECTS
-------------------------------- */

function getActiveEffectCount(
  map: Image,
  library: EffectLibrary
): number {
  const weather =
    getMapWeather(map);

  return library.effects.filter(
    (effect) =>
      weather.effects[
        effect.id
      ]?.enabled === true
  ).length;
}


/* --------------------------------
   MAP SORTING
-------------------------------- */

function sortMaps(
  maps: Image[],
  library: EffectLibrary
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
              b,
              library
            ) -
            getActiveEffectCount(
              a,
              library
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
              a,
              library
            ) -
            getActiveEffectCount(
              b,
              library
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
   METADATA CLEANUP
-------------------------------- */

async function cleanMapMetadata(
  maps: Image[],
  library: EffectLibrary
): Promise<void> {
  const validIds =
    new Set(
      library.effects.map(
        (effect) =>
          effect.id
      )
    );

  for (
    const map of maps
  ) {
    const weather =
      getMapWeather(map);

    const storedIds =
      Object.keys(
        weather.effects
      );

    const cleanedEntries =
      Object.entries(
        weather.effects
      ).filter(
        ([effectId]) =>
          validIds.has(
            effectId
          )
      );

    if (
      cleanedEntries.length ===
      storedIds.length
    ) {
      continue;
    }

    const cleanedEffects =
      Object.fromEntries(
        cleanedEntries
      );

    await OBR.scene.items.updateItems(
      [map.id],
      (items) => {
        for (
          const item of items
        ) {
          if (
            !isImage(item)
          ) {
            continue;
          }

          item.metadata[
            MAP_WEATHER_KEY
          ] = {
            version: 1,
            effects:
              cleanedEffects,
          } satisfies MapWeatherMetadata;
        }
      }
    );
  }
}


/* --------------------------------
   GRID-AWARE GEOMETRY
-------------------------------- */

/*
 * Owlbear stores image size in pixels,
 * while image.grid.dpi tells us how many
 * pixels equal one grid cell.
 *
 * Combined with the item's scale, this
 * gives us the displayed size in grid
 * columns / rows.
 */
function getDisplayedGridSize(
  image: Image
) {
  const baseColumns =
    image.image.width /
    image.grid.dpi;

  const baseRows =
    image.image.height /
    image.grid.dpi;

  return {
    columns:
      baseColumns *
      image.scale.x,

    rows:
      baseRows *
      image.scale.y,
  };
}

/*
 * Determine what scale the overlay
 * requires so that it occupies exactly
 * the same number of displayed grid
 * columns and rows as the map.
 */
function getOverlayScale(
  map: Image,
  asset: LinkedAsset
) {
  const mapSize =
    getDisplayedGridSize(
      map
    );

  const assetColumns =
    asset.image.width /
    asset.grid.dpi;

  const assetRows =
    asset.image.height /
    asset.grid.dpi;

  return {
    x:
      mapSize.columns /
      assetColumns,

    y:
      mapSize.rows /
      assetRows,
  };
}

/*
 * image.grid.offset describes where the
 * image's grid is offset relative to the
 * image itself.
 *
 * To align the actual artwork rectangle
 * rather than the map's shifted grid
 * alignment point, convert the map's grid
 * offset into displayed scene-space pixels
 * and back out that offset.
 *
 * This gives us the top-left of the actual
 * visible map image.
 */
function getMapVisualTopLeft(
  map: Image
) {
  const offsetX =
    map.grid.offset.x *
    map.scale.x;

  const offsetY =
    map.grid.offset.y *
    map.scale.y;

  return {
    x:
      map.position.x -
      offsetX,

    y:
      map.position.y -
      offsetY,
  };
}

/*
 * The linked weather asset can have its
 * own grid offset. We need its final item
 * position to account for that as well so
 * its artwork top-left lands exactly on
 * the map artwork top-left.
 */
function getOverlayPosition(
  map: Image,
  asset: LinkedAsset,
  overlayScale: {
    x: number;
    y: number;
  }
) {
  const mapTopLeft =
    getMapVisualTopLeft(
      map
    );

  const overlayOffsetX =
    asset.grid.offset.x *
    overlayScale.x;

  const overlayOffsetY =
    asset.grid.offset.y *
    overlayScale.y;

  return {
    x:
      mapTopLeft.x +
      overlayOffsetX,

    y:
      mapTopLeft.y +
      overlayOffsetY,
  };
}


/* --------------------------------
   OVERLAY METADATA HELPERS
-------------------------------- */

function getOverlayMetadata(
  item: Image
):
  | OverlayMetadata
  | undefined {
  return item.metadata[
    OVERLAY_KEY
  ] as
    | OverlayMetadata
    | undefined;
}

function makeOverlayKey(
  mapId: string,
  effectId: string
): string {
  return `${mapId}:${effectId}`;
}


/* --------------------------------
   CREATE STATIC OVERLAY
-------------------------------- */

async function createOverlay(
  map: Image,
  effect: EffectDefinition
): Promise<void> {
  if (!effect.asset) {
    return;
  }

  const scale =
    getOverlayScale(
      map,
      effect.asset
    );

  const position =
    getOverlayPosition(
      map,
      effect.asset,
      scale
    );

  const overlay =
    buildImage(
      effect.asset.image,
      effect.asset.grid
    )
      .name(
        `Weather: ${effect.name} — ${getMapName(
          map
        )}`
      )

      /*
       * Align image artwork top-left
       * to image artwork top-left.
       */
      .position(
        position
      )

      /*
       * Match map rotation for now.
       * For unrotated maps this is 0.
       */
      .rotation(
        map.rotation
      )

      /*
       * Scale in grid-space rather than
       * raw pixel dimensions.
       */
      .scale(
        scale
      )

      .layer(
        "ATTACHMENT"
      )

      .locked(true)
      .disableHit(true)

      .metadata({
        [OVERLAY_KEY]: {
          version: 1,

          mapId:
            map.id,

          effectId:
            effect.id,

          assetUrl:
            effect.asset
              .image.url,
        } satisfies OverlayMetadata,
      })

      .build();

  await OBR.scene.items.addItems(
    [overlay]
  );
}


/* --------------------------------
   STATIC OVERLAY SYNC
-------------------------------- */

async function syncOverlays(
  maps: Image[],
  library: EffectLibrary
): Promise<void> {
  const validMapIds =
    new Set(
      maps.map(
        (map) =>
          map.id
      )
    );

  const validEffects =
    new Map(
      library.effects.map(
        (effect) => [
          effect.id,
          effect,
        ]
      )
    );

  const overlays =
    await OBR.scene.items.getItems(
      (item): item is Image =>
        isImage(item) &&
        Boolean(
          item.metadata[
            OVERLAY_KEY
          ]
        )
    );

  const existing =
    new Map<
      string,
      Image[]
    >();


  /*
   * Clean malformed and orphaned
   * overlays first.
   */
  for (
    const overlay of overlays
  ) {
    const metadata =
      getOverlayMetadata(
        overlay
      );

    if (!metadata) {
      await OBR.scene.items
        .deleteItems([
          overlay.id,
        ]);

      continue;
    }

    if (
      !validMapIds.has(
        metadata.mapId
      ) ||
      !validEffects.has(
        metadata.effectId
      )
    ) {
      await OBR.scene.items
        .deleteItems([
          overlay.id,
        ]);

      continue;
    }

    const key =
      makeOverlayKey(
        metadata.mapId,
        metadata.effectId
      );

    const group =
      existing.get(key) ??
      [];

    group.push(
      overlay
    );

    existing.set(
      key,
      group
    );
  }

  const wantedKeys =
    new Set<string>();


  for (
    const map of maps
  ) {
    const weather =
      getMapWeather(map);

    for (
      const effect of
        library.effects
    ) {
      const settings =
        weather.effects[
          effect.id
        ];

      if (
        settings?.enabled !==
          true ||
        !effect.asset
      ) {
        continue;
      }

      const key =
        makeOverlayKey(
          map.id,
          effect.id
        );

      wantedKeys.add(
        key
      );

      const matches =
        existing.get(key) ??
        [];


      /*
       * Only one overlay per
       * map/effect pair.
       */
      if (
        matches.length > 1
      ) {
        await OBR.scene.items
          .deleteItems(
            matches
              .slice(1)
              .map(
                (item) =>
                  item.id
              )
          );
      }

      const current =
        matches[0];


      /*
       * No overlay exists yet.
       */
      if (!current) {
        await createOverlay(
          map,
          effect
        );

        continue;
      }


      const metadata =
        getOverlayMetadata(
          current
        );


      /*
       * Linked asset changed:
       * recreate it.
       */
      if (
        metadata?.assetUrl !==
        effect.asset.image.url
      ) {
        await OBR.scene.items
          .deleteItems([
            current.id,
          ]);

        await createOverlay(
          map,
          effect
        );

        continue;
      }


      /*
       * Current asset is correct.
       * Recalculate its placement and
       * dimensions from map grid-space.
       */
      const desiredScale =
        getOverlayScale(
          map,
          effect.asset
        );

      const desiredPosition =
        getOverlayPosition(
          map,
          effect.asset,
          desiredScale
        );

      const needsUpdate =
        Math.abs(
          current.position.x -
            desiredPosition.x
        ) > 0.01 ||
        Math.abs(
          current.position.y -
            desiredPosition.y
        ) > 0.01 ||
        Math.abs(
          current.scale.x -
            desiredScale.x
        ) > 0.0001 ||
        Math.abs(
          current.scale.y -
            desiredScale.y
        ) > 0.0001 ||
        Math.abs(
          current.rotation -
            map.rotation
        ) > 0.001 ||
        current.locked !==
          true ||
        current.disableHit !==
          true;

      if (
        needsUpdate
      ) {
        await OBR.scene.items
          .updateItems(
            [current.id],
            (items) => {
              for (
                const item
                of items
              ) {
                item.position = {
                  x:
                    desiredPosition.x,
                  y:
                    desiredPosition.y,
                };

                item.rotation =
                  map.rotation;

                item.scale = {
                  x:
                    desiredScale.x,
                  y:
                    desiredScale.y,
                };

                item.locked =
                  true;

                item.disableHit =
                  true;
              }
            }
          );
      }
    }
  }


  /*
   * Remove overlays which are no
   * longer enabled/wanted.
   */
  for (
    const [
      key,
      items,
    ] of existing
  ) {
    if (
      wantedKeys.has(
        key
      )
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


/* --------------------------------
   UI: MAP EFFECT ROW
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

  if (
    settings.enabled
  ) {
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

  toggle.type =
    "button";

  toggle.className =
    "effect-toggle";

  if (
    settings.enabled
  ) {
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

  top.appendChild(
    toggle
  );

  row.appendChild(
    top
  );


  /*
   * Still stored but not yet applied
   * visually to static PNG overlays.
   */
  if (
    settings.enabled
  ) {
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

    slider.type =
      "range";

    slider.min =
      "0";

    slider.max =
      "100";

    slider.step =
      "5";

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


/* --------------------------------
   UI: MAP CARD
-------------------------------- */

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
      map,
      library
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

  header.type =
    "button";

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

  card.appendChild(
    header
  );

  if (
    expanded
  ) {
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

    card.appendChild(
      body
    );
  }

  return card;
}


/* --------------------------------
   UI: LIBRARY ROW
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

  if (
    effect.asset
  ) {
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

  link.type =
    "button";

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

  rename.type =
    "button";

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

  if (
    effect.asset
  ) {
    const unlink =
      document.createElement(
        "button"
      );

    unlink.type =
      "button";

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
    effect.id !==
    "rain"
  ) {
    const remove =
      document.createElement(
        "button"
      );

    remove.type =
      "button";

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
   MAIN UI RENDER
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

  const library =
    await getEffectLibrary();

  const rawMaps =
    await getRawMaps();

  const maps =
    sortMaps(
      rawMaps,
      library
    );

  root.innerHTML = `
    <main class="panel">

      <header class="app-header">
        <div>
          <h1>
            Weather Layers
          </h1>

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

  if (
    sortSelect
  ) {
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

  if (
    mapList
  ) {
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

  if (
    libraryList
  ) {
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
   FULL REFRESH
-------------------------------- */

async function performRefresh():
  Promise<void> {
  const library =
    await getEffectLibrary();

  const maps =
    await getRawMaps();

  await cleanMapMetadata(
    maps,
    library
  );

  await syncOverlays(
    maps,
    library
  );

  await render();
}

async function requestRefresh():
  Promise<void> {
  if (
    refreshing
  ) {
    refreshAgain = true;
    return;
  }

  do {
    refreshAgain = false;
    refreshing = true;

    try {
      await performRefresh();
    } finally {
      refreshing = false;
    }
  } while (
    refreshAgain
  );
}


/* --------------------------------
   STARTUP
-------------------------------- */

OBR.onReady(
  async () => {
    await requestRefresh();

    OBR.scene.items.onChange(
      async () => {
        await requestRefresh();
      }
    );

    OBR.room.onMetadataChange(
      async () => {
        await requestRefresh();
      }
    );

    OBR.scene.onReadyChange(
      async (ready) => {
        if (
          ready
        ) {
          await requestRefresh();
        }
      }
    );
  }
);
