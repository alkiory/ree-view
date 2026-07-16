// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — paleta exacta extraída del mockup aprobado (ree_dashboard_redesign.jsx).
// Cualquier color/porcentaje nombrado en los componentes debe provenir de aquí.
// Tailwind variables equivalentes viven en `index.css` (`--c-*`).
// ─────────────────────────────────────────────────────────────────────────────

export const C = {
  bg: "#0A0F1C",
  surface: "#101828",
  surfaceAlt: "#0D1420",
  border: "#1E2A42",
  text: "#EAF0FB",
  muted: "#7C8BA6",
  renewable: "#34D399",
  renewableDim: "#1F5A46",
  nonRenewable: "#F0A93D",
  nonRenewableDim: "#6B4E22",
  live: "#38BDF8",
  danger: "#F87171",
} as const;

export type DesignToken = keyof typeof C;

// ─────────────────────────────────────────────────────────────────────────────
// Renewable / non-renewable mix datasets (reusados por `GenerationCard`).
// Equivalentes a `REENERVABLE_MIX` y `NON_RENEWABLE_MIX` del API REE.
// ─────────────────────────────────────────────────────────────────────────────

export interface RenewableMixItem {
  name: string;
  value: number;
  pct: number;
  color: string;
}

export const RENEWABLE_MIX: readonly RenewableMixItem[] = [
  { name: "Solar fotovoltaica", value: 243928, pct: 26.3, color: "#34D399" },
  { name: "Hidráulica", value: 92228, pct: 10.0, color: "#2DD4BF" },
  { name: "Eólica", value: 90549, pct: 9.8, color: "#5EEAD4" },
  { name: "Solar térmica", value: 21928, pct: 2.4, color: "#A7F3D0" },
  { name: "Otras renovables", value: 12738, pct: 1.4, color: "#6EE7B7" },
  { name: "Residuos renovables", value: 1993, pct: 0.2, color: "#99F6E4" },
] as const;

export const NON_RENEWABLE_MIX: readonly RenewableMixItem[] = [
  { name: "Ciclo combinado", value: 208354, pct: 12.8, color: "#F0A93D" },
  { name: "Nuclear", value: 141789, pct: 8.7, color: "#FBBF24" },
  { name: "Cogeneración", value: 43907, pct: 2.7, color: "#F59E0B" },
  { name: "Motores diésel", value: 7939, pct: 0.5, color: "#D97706" },
  { name: "Turbina de vapor", value: 9800, pct: 0.6, color: "#EA9E4F" },
  { name: "Carbón", value: 3505, pct: 0.2, color: "#B45309" },
  { name: "Turbina de gas", value: 2546, pct: 0.2, color: "#C2760B" },
  { name: "Residuos no renovables", value: 2659, pct: 0.2, color: "#92400E" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Regiones eléctricas — puramente decorativas en la sección «en vivo»;
// el dataset por región está pendiente para una iteración posterior.
// Ver CURRENT.md §6 Deuda Técnica.
//
// La data de DEMANDA live (curva horaria, MW instantáneo, % renovables)
// ya NO vive en este archivo: viene del resolver `getLiveSnapshot`
// con TTL 60s en backend. La curva horaria «como tal» que está en
// `DEMAND_CURVE` (legacy) se eliminó en esta sesión porque introducía
// drift entre mocks y datos en vivo. Si necesitas un shape TypeScript
// para los puntos horarios, impórtalo de `useLiveDemand.ts`.
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
