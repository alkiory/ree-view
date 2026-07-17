// ─────────────────────────────────────────────────────────────────────────────
// §3.44 — useChartTheme() hook.
//
// POR QUÉ EXISTE:
//   `frontend/src/libs/design-tokens.ts` (post-§3.44) expone `C.*` como
//   strings `var(--c-X)` para que el browser pinte dark↔light sin React
//   re-render. Esto funciona para `style={{ color: C.text }}` porque el
//   attribute pasa a CSS crudo y la cascada resuelve el var.
//
//   PERO recharts (AreaChart, RadialBarChart, PieChart en
//   `live-demand-card.tsx`, `generation-card.tsx`) consume colors vía
//   PROPS JS: `fill={C.renewable}` se traduce al atributo `fill` del
//   elemento SVG renderizado. SVG 2 + browsers modernos ACEPTAN vars
//   presentation-attribute, pero recharts INTERNAMENTE computa algunas
//   transformaciones (gradient ID resolution, `<Cell fill=...>` interno)
//   que históricamente rechazan vars. Por seguridad, este hook lee
//   `getComputedStyle().getPropertyValue('--c-X')` que devuelve un HEX
//   resuelto por el browser, listo para recharts sin ambigüedad.
//
// CUÁNDO SE RE-LEE:
//   `MutationObserver(documentElement, attributes:['data-theme'])`.
//   Cuando `useTheme` toggle aplica el atributo, el observer dispara, se
//   vuelve a leer CSS, los componentes que usan el hook re-renderizan con
//   los nuevos hex. Coste: ~3 charts × 1 MSMount cada theme flip. Aceptable.
//
// USO:
//   const T = useChartTheme();
//   <Area stroke={T.live} fill="url(#areaGrad)" />
//
// NOTA:
//   NO usa `useState` lazy initializer con SSR fallback porque el proyecto
//   es SPA puro (Vite). El estado inicial siempre corre en cliente.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

// Mapa CSS var → nombre corto del token. Manteniendo el subset de tokens
// que recharts usa efectivamente (no todos los 30+ tokens son necesarios;
// los pri María son los 10 del palette base + status).
const VAR_TO_KEY: ReadonlyArray<readonly [string, string]> = [
  ["--c-bg", "bg"],
  ["--c-surface", "surface"],
  ["--c-surface-alt", "surfaceAlt"],
  ["--c-border", "border"],
  ["--c-text", "text"],
  ["--c-muted", "muted"],
  ["--c-renewable", "renewable"],
  ["--c-non-renewable", "nonRenewable"],
  ["--c-live", "live"],
  ["--c-danger", "danger"],
] as const;

export type ChartTokens = Readonly<Record<string, string>>;

/** Lee las CSS vars theme-resolved y devuelve Record<name, hex>. */
function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const entries = VAR_TO_KEY.map(([cssVar, key]) => [
    key,
    cs.getPropertyValue(cssVar).trim(),
  ]);
  return Object.fromEntries(entries);
}

/**
 * Hook que devuelve los tokens resolved (HEX string, no var()) para ser
 * usados por recharts y cualquier consumer que requiera color computado
 * en JS. Re-render reactivo cuando `data-theme` attribute de <html>
 * cambia (ThemeToggle dispara el flip).
 *
 * Importante: un flip de tema causa re-mount interno del AreaChart /
 * RadialBarChart / PieChart (recharts internamente ignora cambios de
 * fill cuando ya montó sus gradients). Aceptable porque solo se ejecuta
 * 3 charts en `live-demand-card.tsx` + `generation-card.tsx`, y el
 * usuario togglea tema en contadas ocasiones.
 */
export function useChartTheme(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(() => readTokens());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTokens(readTokens());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return tokens;
}
