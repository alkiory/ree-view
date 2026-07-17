import { useEffect, useState } from "react";

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

function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement);
  const entries = VAR_TO_KEY.map(([cssVar, key]) => [
    key,
    cs.getPropertyValue(cssVar).trim(),
  ]);
  return Object.fromEntries(entries);
}

/**
 * Hook que devuelve los tokens CSS resolved (hex ya computado, no
 * `var()`) para consumidores recharts que requieren color computado
 * en JS. Re-render reactivo cuando el atributo `data-theme` de `<html>`
 * cambia.
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
