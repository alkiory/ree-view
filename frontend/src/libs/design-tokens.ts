// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — paleta Fase 2 (adaptada del kit "Full Charts Components",
// Frank Esteban Isdray, Figma Community, CC BY 4.0).
// Cualquier color/porcentaje nombrado en los componentes debe provenir de aquí.
// Tailwind variables equivalentes viven en `index.css` (`--c-*`).
//
// §3.44 — Theme toggle (sol/luna) wiring. Los valores de cada token SON
// referencias `var(--c-X)` (no hex literales) para que el browser pinte
// el flip dark↔light sin re-render de React. Los valores concretos de las
// vars viven en `:root` (dark, default) y `:root[data-theme="light"]` (override)
// de `index.css`. Recharts no acepta strings `var()` para fill/stroke → ver
// `hooks/useChartTheme.ts` que lee las vars vía getComputedStyle y devuelve
// hex resolved para esos casos aislados.
//
// Decisión §3.29 (Fase 2 UI):
//   • DOS familias semánticas (renewable = cool, nonRenewable = warm).
//   • 5 accents LIBRES (sin carga semántica: KPIs, países, sparklines).
//   • Misma hex puede aparecer en accentCyan Y renewableAlt[2] (dual-coding
//     intencional per user's defaults). El CONTEXTO define la semántica,
//     NO el nombre del token.
// ─────────────────────────────────────────────────────────────────────────────

export const C = {
  bg: "var(--c-bg)",
  surface: "var(--c-surface)",
  surfaceAlt: "var(--c-surface-alt)",
  border: "var(--c-border)",
  text: "var(--c-text)",
  muted: "var(--c-muted)",

  // ── Semantic families — primary anchors ──────────────────────────────────
  renewable: "var(--c-renewable)", // verde (primary renewable: gauge leading color)
  renewableDim: "var(--c-renewable-dim)", // dark fallback for renewable wedges sin color
  nonRenewable: "var(--c-non-renewable)",
  nonRenewableDim: "var(--c-non-renewable-dim)",

  // ── Libre accents (sin carga semántica — KPIs, países, sparklines) ──────
  accentPink: "var(--c-accent-pink)",
  accentPurple: "var(--c-accent-purple)", // ⚠ dual: also `nonRenewableAlt[0]`
  accentCyan: "var(--c-accent-cyan)", // ⚠ dual: also `renewableAlt[2]`
  accentGold: "var(--c-accent-gold)", // ⚠ dual: also `nonRenewableAlt[2]`
  accentOrange: "var(--c-accent-orange)", // ⚠ dual: also `nonRenewableAlt[3]`

  // ── Semantic family palettes (4 colors per family, NO violators) ─────────
  // Renewable (cool — dark): verde, teal, cian, menta. En light sustituyen
  // por versiones oscurecidas para contrast WCAG AA sobre fondo claro.
  renewableAlt: [
    "var(--c-renewable)",
    "var(--c-non-renewable-dim)", // teal→dim (light override lo adapta)
    "var(--c-accent-cyan)",
    "var(--c-renewable-dim)", // menta→dim (light override)
  ] as const,
  nonRenewableAlt: [
    "var(--c-accent-purple)",
    "var(--c-accent-pink)",
    "var(--c-accent-gold)",
    "var(--c-accent-orange)",
  ] as const,

  // ── Status / context ────────────────────────────────────────────────────
  live: "var(--c-live)",
  danger: "var(--c-danger)",

  // ── §3.44 NEW — Texto complementario sobre fondos semánticos brillantes ──
  // Antes (#3.30 cleanup): hex literales leaked (`'#1A0606'`, `'#062017'`,
  // `'#04222F'`) vivían en 6 sitios (3× peligro, 1× renewable, 1× live, 1×
  // data-selector). Theme toggle exige tokens para mantener contraste WCAG
  // AA en ambos themes.
  textOnDanger: "var(--c-text-on-danger)",
  textOnRenewable: "var(--c-text-on-renewable)",
  textOnLive: "var(--c-text-on-live)",

  // ── §3.44 NEW — Alpha tokens (reemplazan `${C.X}NN` template literals) ──
  // Antes: `background: ${C.muted}1A` producía un hex válido pero NO temático.
  // Después: color-mix en CSS produce un color con alpha tema-reactivo
  // (10% dark-muted → 10% light-muted automáticamente). El componente cita
  // `C.mutedSoft` y la token resolution ocurre en CSS puro.
  mutedSoft: "var(--c-muted-soft)",
  mutedPill: "var(--c-muted-pill)",
  liveSoft: "var(--c-live-soft)",
  accentGoldSoft: "var(--c-accent-gold-soft)",
  accentGoldFaint: "var(--c-accent-gold-faint)",
  accentGoldPill: "var(--c-accent-gold-pill)",
  accentGoldEdge: "var(--c-accent-gold-edge)",
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
// viven ONLY en `index.css` (dark/light theme blocks).
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
// fuera de `index.css`.
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
//
// ⚠ §3.44 caution: `palette[index]` ahora es `var(--c-X)` (no hex). Si
// el caller necesita un HEX literal (recharts fill etc.), debe resolver
// primero vía `useChartTheme()` (ver hooks/useChartTheme.ts).
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
    // Cast dropped: con `as const` sobre los arrays, TS permite retornar
    // `palette[index]` assignable a string. §3.44: estos strings ahora son
    // `var(--c-X)` references — válido para CSS contexts pero NO para
    // recharts props (que exige hex vía useChartTheme).
    return palette[index];
  }
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — country mapping (libre accents per país, ISO chip 2 letras).
// Default #3 del usuario: render chip ISO en vez de emoji flag.
//
// §3.44: country colors apuntan a `var(--c-accent-X)` para seguir tema.
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
// §3.44: ahora via CSS var — el theme switch flipea automáticamente.
export const COUNTRY_COLORS: Readonly<Record<string, string>> = {
  España: "var(--c-accent-cyan)", // accentCyan dark / Cyan 600 light
  Francia: "var(--c-accent-pink)", // accentPink dark / Red 600 light
  Portugal: "var(--c-accent-cyan)",
  Marruecos: "var(--c-accent-purple)",
  Andorra: "var(--c-accent-gold)",
} as const;

// Fallbacks para cuando la API devuelve un país no catalogado.
// §3.44: FALLBACK_COUNTRY_COLOR via CSS var para consistencia tema-aware.
export const FALLBACK_COUNTRY_CODE = "??";
export const FALLBACK_COUNTRY_COLOR = "var(--c-muted)";

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

// ─────────────────────────────────────────────────────────────────────────────
// §3.44 NEW — Theme tokens
// ─────────────────────────────────────────────────────────────────────────────

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ree-view-theme";

/** Tema default si localStorage no tiene valor persistido. Dark mantiene
 *  el UX histórico (no cambia apariencia en primer load). */
export const DEFAULT_THEME: Theme = "dark";
