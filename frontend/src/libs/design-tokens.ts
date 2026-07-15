// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — paleta exacta extraída del mockup aprobado (ree_dashboard_redesign.jsx).
// Cualquier color/porcentaje nombrado en los componentes debe provenir de aquí.
// Tailwind variables equivalentes viven en `index.css` (`--c-*`).
// ─────────────────────────────────────────────────────────────────────────────

export const C = {
  bg: '#0A0F1C',
  surface: '#101828',
  surfaceAlt: '#0D1420',
  border: '#1E2A42',
  text: '#EAF0FB',
  muted: '#7C8BA6',
  renewable: '#34D399',
  renewableDim: '#1F5A46',
  nonRenewable: '#F0A93D',
  nonRenewableDim: '#6B4E22',
  live: '#38BDF8',
  danger: '#F87171',
} as const;

export type DesignToken = keyof typeof C;

// ─────────────────────────────────────────────────────────────────────────────
// Canonical mock datasets (reuse para "Datos en tiempo real" — sección sin
// endpoint real todavía, ver CURRENT.md §6 — Deuda Técnica — punto 12 sobre
// PORT=3001, y README Tier 3 separando i18n).
// ─────────────────────────────────────────────────────────────────────────────

export interface RenewableMixItem {
  name: string;
  value: number;
  pct: number;
  color: string;
}

export const RENEWABLE_MIX: readonly RenewableMixItem[] = [
  { name: 'Solar fotovoltaica', value: 243928, pct: 26.3, color: '#34D399' },
  { name: 'Hidráulica', value: 92228, pct: 10.0, color: '#2DD4BF' },
  { name: 'Eólica', value: 90549, pct: 9.8, color: '#5EEAD4' },
  { name: 'Solar térmica', value: 21928, pct: 2.4, color: '#A7F3D0' },
  { name: 'Otras renovables', value: 12738, pct: 1.4, color: '#6EE7B7' },
  { name: 'Residuos renovables', value: 1993, pct: 0.2, color: '#99F6E4' },
] as const;

export const NON_RENEWABLE_MIX: readonly RenewableMixItem[] = [
  { name: 'Ciclo combinado', value: 208354, pct: 12.8, color: '#F0A93D' },
  { name: 'Nuclear', value: 141789, pct: 8.7, color: '#FBBF24' },
  { name: 'Cogeneración', value: 43907, pct: 2.7, color: '#F59E0B' },
  { name: 'Motores diésel', value: 7939, pct: 0.5, color: '#D97706' },
  { name: 'Turbina de vapor', value: 9800, pct: 0.6, color: '#EA9E4F' },
  { name: 'Carbón', value: 3505, pct: 0.2, color: '#B45309' },
  { name: 'Turbina de gas', value: 2546, pct: 0.2, color: '#C2760B' },
  { name: 'Residuos no renovables', value: 2659, pct: 0.2, color: '#92400E' },
] as const;

export interface DemandCurvePoint {
  h: string;
  real: number;
  prevista: number;
}

export const DEMAND_CURVE: readonly DemandCurvePoint[] = [
  { h: '00h', real: 24800, prevista: 25200 },
  { h: '02h', real: 22100, prevista: 22600 },
  { h: '04h', real: 20450, prevista: 20900 },
  { h: '06h', real: 21900, prevista: 22000 },
  { h: '08h', real: 27600, prevista: 27300 },
  { h: '10h', real: 30800, prevista: 30200 },
  { h: '12h', real: 31950, prevista: 31500 },
  { h: '14h', real: 32450, prevista: 32800 },
  { h: '16h', real: 30100, prevista: 30600 },
  { h: '18h', real: 29800, prevista: 29500 },
  { h: '20h', real: 33200, prevista: 32700 },
  { h: '22h', real: 28100, prevista: 28400 },
] as const;

export const REGIONS = ['Nacional', 'Peninsular', 'Baleares', 'Canarias', 'Ceuta', 'Melilla'] as const;
export type Region = (typeof REGIONS)[number];
