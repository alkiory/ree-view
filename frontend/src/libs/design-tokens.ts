export const C = {
  bg: "var(--c-bg)",
  surface: "var(--c-surface)",
  surfaceAlt: "var(--c-surface-alt)",
  border: "var(--c-border)",
  text: "var(--c-text)",
  muted: "var(--c-muted)",

  renewable: "var(--c-renewable)",
  renewableDim: "var(--c-renewable-dim)",
  nonRenewable: "var(--c-non-renewable)",
  nonRenewableDim: "var(--c-non-renewable-dim)",

  accentPink: "var(--c-accent-pink)",
  accentPurple: "var(--c-accent-purple)",
  accentCyan: "var(--c-accent-cyan)",
  accentGold: "var(--c-accent-gold)",
  accentOrange: "var(--c-accent-orange)",

  renewableAlt: [
    "var(--c-renewable)",
    "var(--c-non-renewable-dim)",
    "var(--c-accent-cyan)",
    "var(--c-renewable-dim)",
  ] as const,
  nonRenewableAlt: [
    "var(--c-accent-purple)",
    "var(--c-accent-pink)",
    "var(--c-accent-gold)",
    "var(--c-accent-orange)",
  ] as const,

  live: "var(--c-live)",
  danger: "var(--c-danger)",

  textOnDanger: "var(--c-text-on-danger)",
  textOnRenewable: "var(--c-text-on-renewable)",
  textOnLive: "var(--c-text-on-live)",

  mutedSoft: "var(--c-muted-soft)",
  mutedPill: "var(--c-muted-pill)",
  liveSoft: "var(--c-live-soft)",
  accentGoldSoft: "var(--c-accent-gold-soft)",
  accentGoldFaint: "var(--c-accent-gold-faint)",
  accentGoldPill: "var(--c-accent-gold-pill)",
  accentGoldEdge: "var(--c-accent-gold-edge)",
} as const;

export type DesignToken = keyof typeof C;

export interface MixItem {
  name: string;
  value: number;
  pct: number;
  colorIndex: number;
}

export const RENEWABLE_MIX: readonly MixItem[] = [
  { name: "Solar fotovoltaica", value: 243928, pct: 26.3, colorIndex: 0 },
  { name: "Hidráulica", value: 92228, pct: 10.0, colorIndex: 1 },
  { name: "Eólica", value: 90549, pct: 9.8, colorIndex: 2 },
  { name: "Solar térmica", value: 21928, pct: 2.4, colorIndex: 3 },
] as const;

export const NON_RENEWABLE_MIX: readonly MixItem[] = [
  { name: "Ciclo combinado", value: 208354, pct: 12.8, colorIndex: 0 },
  { name: "Nuclear", value: 141789, pct: 8.7, colorIndex: 1 },
  { name: "Cogeneración", value: 43907, pct: 2.7, colorIndex: 2 },
  { name: "Motores diésel", value: 7939, pct: 0.5, colorIndex: 3 },
] as const;

export type ColorFamily = "renewable" | "nonRenewable";

/**
 * Resuelve `palette[index]` con fallback defensivo fuera de rango.
 * Si el caller necesita un HEX literal, debe resolver primero vía
 * `useChartTheme()`.
 */
export function resolveMixColor(family: ColorFamily, index: number): string {
  const palette =
    family === "renewable" ? C.renewableAlt : C.nonRenewableAlt;
  const fallback =
    family === "renewable" ? C.renewableDim : C.nonRenewableDim;
  if (Number.isInteger(index) && index >= 0 && index < palette.length) {
    return palette[index];
  }
  return fallback;
}

/** Mapping país canónico → ISO 3166-1 alpha-2 code. */
export const COUNTRY_CODES: Readonly<Record<string, string>> = {
  España: "ES",
  Francia: "FR",
  Portugal: "PT",
  Marruecos: "MA",
  Andorra: "AD",
} as const;

/** Color libre por país. */
export const COUNTRY_COLORS: Readonly<Record<string, string>> = {
  España: "var(--c-accent-cyan)",
  Francia: "var(--c-accent-pink)",
  Portugal: "var(--c-accent-cyan)",
  Marruecos: "var(--c-accent-purple)",
  Andorra: "var(--c-accent-gold)",
} as const;

/** Fallback para países no catalogados por la API. */
export const FALLBACK_COUNTRY_CODE = "??";
export const FALLBACK_COUNTRY_COLOR = "var(--c-muted)";

/** Datasets sintéticos (10 puntos) para KPI sparklines. */
export const SPARK_SYNTHETIC = {
  generation: [4, 6, 5, 8, 7, 9, 8, 11, 10, 12] as const,
  demand: [30, 32, 28, 34, 31, 33, 35, 32, 34, 36] as const,
  balance: [-2, -4, -3, -6, -5, -7, -6, -8, -7, -9] as const,
  storage: [0, 0, 1, 0, 2, 1, 0, 0, 1, 0] as const,
} as const;

/** Regiones eléctricas (decorativas en la sección «en vivo»). */
export const REGIONS = [
  "Nacional",
  "Peninsular",
  "Baleares",
  "Canarias",
  "Ceuta",
  "Melilla",
] as const;
export type Region = (typeof REGIONS)[number];

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ree-view-theme";

/** Tema default si `localStorage` no tiene valor persistido. */
export const DEFAULT_THEME: Theme = "dark";
