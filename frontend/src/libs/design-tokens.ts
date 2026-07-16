// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — paleta Fase 2 (adaptada del kit "Full Charts Components",
// Frank Esteban Isdray, Figma Community, CC BY 4.0).
// Cualquier color/porcentaje nombrado en los componentes debe provenir de aquí.
// Tailwind variables equivalentes viven en `index.css` (`--c-*`).
//
// Decisión §3.29 (Fase 2 UI):
//   • DOS familias semánticas (renewable = cool, nonRenewable = warm).
//   • 5 accents LIBRES (sin carga semántica: KPIs, países, sparklines).
//   • Misma hex puede aparecer en accentCyan Y renewableAlt[2] (dual-coding
//     intencional per user's defaults). El CONTEXTO define la semántica,
//     NO el nombre del token.
//   • Migración de `live`/`danger`/`nonRenewable`/`nonRenewableDim` a los
//     nuevos hex. Auto-propage recolor a `live-demand-card.tsx`,
//     `dashboard-header.tsx`, `data-selector.tsx` sin tocar esos archivos.
// ─────────────────────────────────────────────────────────────────────────────

export const C = {
  bg: "#0A0F1C",
  surface: "#101828",
  surfaceAlt: "#0D1420",
  border: "#1E2A42",
  text: "#EAF0FB",
  muted: "#7C8BA6",

  // ── Semantic families — primary anchors ──────────────────────────────────
  renewable: "#34D399", // verde (primary renewable: gauge leading color)
  renewableDim: "#1F5A46", // dark fallback for renewable wedges sin color
  // [MIGRATED per Fase 2] nonRenewable primary shifted purple so the warm
  // family leads with #8B5CF6 per Figma kit. Era #F0A93D (warm-gold).
  nonRenewable: "#8B5CF6",
  // [MIGRATED per Fase 2] dim companion to keep fallback wedges in-family.
  // Era #6B4E22 (dim gold). Ahora #3D2B66 (deep purple) para que(el
  // wedge sin color de la API)se integre con la nueva paleta warm.
  nonRenewableDim: "#3D2B66",

  // ── Libre accents (sin carga semántica — KPIs, países, sparklines) ──────
  accentPink: "#FF3D77",
  accentPurple: "#8B5CF6", // ⚠ dual: also `nonRenewableAlt[0]`
  accentCyan: "#22D3EE", // ⚠ dual: also `renewableAlt[2]`
  accentGold: "#FFC93C", // ⚠ dual: also `nonRenewableAlt[2]`
  accentOrange: "#FF8A3D", // ⚠ dual: also `nonRenewableAlt[3]`

  // ── Semantic family palettes (4 colors per family, NO violators) ─────────
  // Renewable (cool): verde #34D399, teal #2DD4BF, cian #22D3EE, menta #6EE7B7
  //   — dropparon #38BDF8 (sky-violator) y #A3E635 (lime-violator).
  // NonRenewable (warm): púrpura #8B5CF6, rosa #FF3D77, dorado #FFC93C, naranja #FF8A3D
  //   — dropparon #D946EF (fuchsia-violator) y #FB7185 (rose-violator).
  renewableAlt: ["#34D399", "#2DD4BF", "#22D3EE", "#6EE7B7"] as const,
  nonRenewableAlt: ["#8B5CF6", "#FF3D77", "#FFC93C", "#FF8A3D"] as const,

  // ── Status / context ────────────────────────────────────────────────────
  // [MIGRATED per Fase 2] era #38BDF8 (sky blue) — el nuevo cyan alinea con
  // el Figma accent. Auto-recolorea `live-demand-card.tsx`.
  live: "#22D3EE",
  // [MIGRATED per Fase 2] era #F87171 (red) — el nuevo pink alinea con el
  // warm family. Auto-recolorea todos los error states + uso KPI condicional.
  danger: "#FF3D77",
} as const;

export type DesignToken = keyof typeof C;

// ─────────────────────────────────────────────────────────────────────────────
// Renewable / non-renewable mix datasets (Reference fixtures — Phase 2 los
// trunca a top-4 por valor #1). En PRODUCCIÓN los wedges usan los colores
// devueltos por `processGenerationData(energyBalances)` desde la API REE;
// estos arrays son solo para demos/tests.
//
// Phase 2 §3.30 update: items ya NO inline-an hex en `color: string`.
// Reemplazan `color` por `colorIndex: number` que se resuelve vía
// `resolveMixColor(family, index)` contra `C.renewableAlt[]` /
// `C.nonRenewableAlt[]`. GARANTIZA single source of truth: hex literals
// viven ONLY en `design-tokens.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export interface MixItem {
  name: string;
  value: number;
  pct: number;
  // Index into `C.renewableAlt[]` (renewable family) o
  // `C.nonRenewableAlt[]` (non-renewable family). El contexto del array
  // determina qué familia. Resolver con `resolveMixColor()`.
  colorIndex: number;
}

// 4 cats por default #1 — verde / teal / cyan / menta (cool family).
export const RENEWABLE_MIX: readonly MixItem[] = [
  { name: "Solar fotovoltaica", value: 243928, pct: 26.3, colorIndex: 0 },
  { name: "Hidráulica", value: 92228, pct: 10.0, colorIndex: 1 },
  { name: "Eólica", value: 90549, pct: 9.8, colorIndex: 2 },
  { name: "Solar térmica", value: 21928, pct: 2.4, colorIndex: 3 },
] as const;

// 4 cats por default #1 — púrpura / rosa / dorado / naranja (warm family).
export const NON_RENEWABLE_MIX: readonly MixItem[] = [
  { name: "Ciclo combinado", value: 208354, pct: 12.8, colorIndex: 0 },
  { name: "Nuclear", value: 141789, pct: 8.7, colorIndex: 1 },
  { name: "Cogeneración", value: 43907, pct: 2.7, colorIndex: 2 },
  { name: "Motores diésel", value: 7939, pct: 0.5, colorIndex: 3 },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// MIX color resolver (Phase 2 §3.30 — kills last dual-coding source).
// Index → palette lookup con runtime-safe fallback. Cualquier consumidor
// de MIX (demos/tests/future UI panels) DEBE usar este helper para
// resolver el hex — así el bundle frontend nunca lleva hex literals
// fuera de esta sección de `design-tokens.ts`.
//
// Production wedges en `generation-card.tsx` no usan este helper porque
// los colores vienen directo de `processGenerationData(...).color`
// (atributo string de MongoDB, runtime data). MIX es solo fixtures de
// demo/test — este helper garantiza que cuando se rendericen, sigan
// la nueva paleta sin duplicación de hex.
//
// ⚠ Family mismatch warning: `MixItem` no lleva un discriminator `family`
// (type unification trade-off — ver §3.30 de CURRENT.md). El caller es
// responsable de pasar `family` que MATCHEA el array de origen:
//   RENEWABLE_MIX[i] → resolveMixColor('renewable', item.colorIndex)
//   NON_RENEWABLE_MIX[i] → resolveMixColor('nonRenewable', item.colorIndex)
// Pasar el family equivocado NO falla en TS pero renderiza colores sin
// relación semántica (p.ej. solar FV en púrpura). Si en el futuro pasa
// muchos errores, migrate a discriminated union con `family: ColorFamily`
// embedded en MixItem.
// ─────────────────────────────────────────────────────────────────────────────

export type ColorFamily = "renewable" | "nonRenewable";

export function resolveMixColor(family: ColorFamily, index: number): string {
  const palette = family === "renewable" ? C.renewableAlt : C.nonRenewableAlt;
  // Fallback NOT in family palette: renewableDim is dark green-blue,
  // nonRenewableDim is deep purple. Ambos intencionadamente distintos
  // de la paleta porque wedges rendered con color del API sin mapping
  // necesitan contrastar contra el surface, NO ser visuales confundentes
  // con mix-family members. El spec locking este behavior en 6 tests.
  const fallback = family === "renewable" ? C.renewableDim : C.nonRenewableDim;
  if (Number.isInteger(index) && index >= 0 && index < palette.length) {
    // Cast dropped: con `as const` sobre `C.renewableAlt` / `C.nonRenewableAlt`,
    // TS narrows `palette[index]` a union de literal hex (assignable a string)
    // después del length check. Verificado en build post-§3.30.
    return palette[index];
  }
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — country mapping (libre accents per país, ISO chip 2 letras).
// Default #3 del usuario: render chip ISO en vez de emoji flag.
// ─────────────────────────────────────────────────────────────────────────────

// Mapea nombre de país canónico (devuelto por data REE) → ISO 3166-1 alpha-2.
export const COUNTRY_CODES: Readonly<Record<string, string>> = {
  España: "ES",
  Francia: "FR",
  Portugal: "PT",
  Marruecos: "MA",
  Andorra: "AD",
} as const;

// Color libre per país (sin carga semántica). Alineado con el kit Figma:
// Francia=pink, Portugal=cyan, Marruecos=purple, Andorra=gold.
export const COUNTRY_COLORS: Readonly<Record<string, string>> = {
  España: "#22D3EE", // accentCyan
  Francia: "#FF3D77", // accentPink
  Portugal: "#22D3EE", // accentCyan
  Marruecos: "#8B5CF6", // accentPurple
  Andorra: "#FFC93C", // accentGold
} as const;

// Fallbacks para cuando la API devuelve un país no catalogado.
export const FALLBACK_COUNTRY_CODE = "??";
export const FALLBACK_COUNTRY_COLOR = "#7C8BA6"; // = C.muted

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic sparkline data — Phase 2 default #4 (sin histórico persistido).
// Datasets deterministas (10 puntos) que sugieren una tendencia plausible
// sin pretender ser real data. Phase 3 los reemplazará con datos del
// backend `getLiveSnapshot` (cuando exista histórico diario).
// ─────────────────────────────────────────────────────────────────────────────

export const SPARK_SYNTHETIC = {
  // Generación (TWh acumulado, ligero aumento matutino)
  generation: [4, 6, 5, 8, 7, 9, 8, 11, 10, 12] as const,
  // Demanda (oscilación intra-día)
  demand: [30, 32, 28, 34, 31, 33, 35, 32, 34, 36] as const,
  // Balance (negativo oscilante si exporta más de lo que importa)
  balance: [-2, -4, -3, -6, -5, -7, -6, -8, -7, -9] as const,
  // Storage (oscilación baja, fallos/recuperaciones pequeñas)
  storage: [0, 0, 1, 0, 2, 1, 0, 0, 1, 0] as const,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Regiones eléctricas — puramente decorativas en la sección «en vivo»;
// el dataset por región está pendiente para una iteración posterior.
// Ver CURRENT.md §6 Deuda Técnica.
// ─────────────────────────────────────────────────────────────────────────────

export const REGIONS = [
  "Nacional",
  "Peninsular",
  "Baleares",
  "Canarias",
  "Ceuta",
  "Melilla",
] as const;
export type Region = (typeof REGIONS)[number];
