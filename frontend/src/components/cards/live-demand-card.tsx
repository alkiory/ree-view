import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Card } from "./primitives";
import { C, REGIONS } from "../../libs/design-tokens";
import {
  type LiveDemandData,
  useLiveDemand,
  useHistoricalHourly,
  yesterdayISODate,
  isDegradedSnapshot,
  regionDisplayToSlug,
  type LiveDemandRegion,
} from "../../hooks/useLiveDemand";
import { useChartTheme } from "../../hooks/useChartTheme";
import { extractErrorDetail } from "../../libs/extract-error-detail";

const formatTime = (date: Date): string => {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

const formatDateShort = (iso: string): string => {
  // ISO 8601 date YYYY-MM-DD → 16/07/2026 sin construir Date.
  return iso.split("T")[0]?.split("-").reverse().join("/") ?? iso;
};

const formatGW = (mw: number): string => `${(mw / 1000).toFixed(1)} GW`;
const formatPct = (pct: number): string => `${pct.toFixed(1)}%`;

// `CurrentTime` se aísla en un sub-componente para que el 1s setInterval
// que refresca la etiqueta «Última actualización» sólo re-renderice este
// <span>, evitando que el <AreaChart> (más costoso) reciba un re-render
// por segundo. La `source` ahora es un ISO string (no Date) para que
// React.memo / equality check no re-renderice cuando el refetch de Apollo
// entrega el mismo timestamp (común cuando el cache hit ocurre).
function CurrentTime({ source }: { source: string | null | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const date = source ? new Date(source) : new Date();
  return (
    <span className="text-[11px]" style={{ color: C.muted }}>
      Última actualización · {formatTime(date)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 §3.39 — DISCARDED CHIPS for mode awareness.
//   - 'loading'     → CARGANDO (muted pulse) — Apollo initial fetch en vuelo
//   - 'live'        → EN VIVO (cyan, pulsing dot)
//   - 'historical'  → HISTÓRICO (muted, bordered) — incluye el caso
//                     «live degradado + historical unavailable» que
//                     §3.32 etiquetaba 'mock'. Ahora se renderiza
//                     como 'historical' con `renderedSnap=undefined`
//                     → chart muestra «Sin curva horaria disponible».
//                     Production NUNCA enseña datos sintéticos.
//
// Phase 2 §3.32 — el chip DEMO vivía aquí. MOVIDO a
// `mock-live-demand-card.tsx` (§3.39) y gateado tras
// `VITE_ENABLE_MOCK_FALLBACK=true`. Por eliminación, Mode ahora tiene
// 3 valores; el Record<Mode, …> exhaustivo abajo compila-time
// garantiza que cualquier futuro Mode value añadido al union requiera
// actualizar los 3 records (CAPTION/COLOR/GRADIENT_ID) en bloque.
// ─────────────────────────────────────────────────────────────────────────────
function Chip({ mode }: { mode: Mode }) {
  if (mode === "loading") {
    return (
      <span
        className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border"
        style={{
          background: C.mutedSoft,
          color: C.muted,
          borderColor: C.border,
        }}
        aria-label="Cargando datos en vivo desde apiDatos REE"
        data-testid="chip-loading"
      >
        <span
          className="pulse-dot w-2 h-2 rounded-full"
          style={{ background: C.muted }}
          aria-hidden
        />
        CARGANDO
      </span>
    );
  }
  if (mode === "live") {
    return (
      <span
        className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold"
        style={{ background: C.liveSoft, color: C.live }}
        data-testid="chip-live"
      >
        <span className="relative w-2 h-2">
          <span className="pulse-dot absolute inset-0" />
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: C.live }}
          />
        </span>
        EN VIVO
      </span>
    );
  }
  if (mode === "historical") {
    return (
      <span
        className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border"
        style={{
          background: C.mutedPill,
          color: C.muted,
          borderColor: C.border,
        }}
        aria-label="Snapshot live degradado: mostrando histórico"
        data-testid="chip-historical"
      >
        HISTÓRICO
      </span>
    );
  }
  // Phase 2 §3.39 — removed 'mock' mode. Si llegamos aquí con un
  // Mode value inesperado, devolvemos el chip de loading como
  // fallback defensivo (TS exhaustiveness check arriba cubre los 3
  // cases reales; este branch es sólo para Mode == undefined).
  return (
    <span
      className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border"
      style={{
        background: C.mutedSoft,
        color: C.muted,
        borderColor: C.border,
      }}
      data-testid="chip-loading"
    >
      <span
        className="pulse-dot w-2 h-2 rounded-full"
        style={{ background: C.muted }}
        aria-hidden
      />
      CARGANDO
    </span>
  );
}

/**
 * Phase 2 §3.39 — discriminated union for the 3 render modes.
 *
 *   `'loading'`    Apollo fetch inicial en vuelo — chip "CARGANDO"
 *                   + chart loader (positional coherence: antes el
 *                   chip decía "EN VIVO" mientras body "Sin curva
 *                   horaria..." → UX gap engañoso).
 *   `'live'`       snap limpio de REE.
 *   `'historical'` fallback a ayer cuando live degraded; incluye el
 *                   caso «live degradado + historical no disponible»
 *                   (que §3.32 etiquetaba 'mock') — el chart
 *                   muestra «Sin curva horaria disponible.» y los
 *                   KPIs caen a `—`. Cero datos sintéticos en
 *                   producción.
 *
 * Phase 2 §3.32 — el 4to mode `'mock'` fue ELIMINADO. La data
 * sintética ahora vive en `mock-live-demand-card.tsx`, gateada tras
 * `VITE_ENABLE_MOCK_FALLBACK=true`. Por reducción de 4 → 3 valores,
 * los Records `CAPTION_FOR_MODE` / `COLOR_FOR_MODE` /
 * `GRADIENT_ID_FOR_MODE` abajo pierden la entrada `mock`.
 */
type Mode = "loading" | "live" | "historical";

// Footer caption per Mode. Declarative Record lookup vs nested ternary —
// evita missed-branch bugs cuando se añada un 4to mode en el futuro.
const CAPTION_FOR_MODE: Record<Mode, string> = {
  loading: "Inicializando conexión con apiDatos REE…",
  live: "Datos en vivo desde apiDatos REE · snapshot cacheado en backend con TTL 60s · poll de 60s desde el frontend",
  historical:
    "Fallback histórico (ayer) · datos en vivo desde apiDatos REE no disponibles · poll de 60s",
};

// Color per Mode: chart stroke, gradient stopColor, footer caption,
// "Demanda real" legend dot, legend background. Record<Mode, …>
// garantiza exhaustividad en compile-time — un 4to Mode value se
// convierte en TS error, no en silent visual regression.
//
// Convenciones Fase 2 §3.39:
//   loading    → muted (curva no se renderiza; placeholder estático)
//   live       → live (cyan, vibrante)
//   historical → muted (desaturado: indica que estamos en fallback o
//               upstream no responde)
const COLOR_FOR_MODE: Record<Mode, string> = {
  loading: C.muted,
  live: C.live,
  historical: C.muted,
};

// Gradient id per Mode: live + loading comparten `demandFill` porque
// loading no renderiza curva (loader estático) pero para exhaustiveness
// referenciamos el id del cyan fill; Apollo → live reusa el mismo.
const GRADIENT_ID_FOR_MODE: Record<Mode, string> = {
  loading: "demandFill",
  live: "demandFill",
  historical: "demandFillHistorical",
};

function deriveMode(args: {
  live: LiveDemandData | undefined;
  historical: LiveDemandData | undefined;
  loadingHistorical: boolean;
  regionSlug: LiveDemandRegion | undefined;
  dateYesterday: string;
}): Mode {
  const { live, historical, loadingHistorical, regionSlug, dateYesterday } =
    args;

  // Phase 2 §3.32 polish (Q1) — coherent initial-loading state.
  //  Apollo v3 `useQuery`: `data` permanece `undefined` hasta que
  //  el primer fetch resuelve. (Loading ⇒ `live === undefined`
  //  están acoplados; no necesitamos flag `loadingLive` separado.)
  //  Sin este branch:
  //    - chip decía "EN VIVO" (versión previa retornaba 'live'),
  //    - body decía "Sin curva horaria disponible." (porque
  //      renderedSnap.demandCurve era undefined),
  //    → UX mismatch: el usuario creía tener datos pero en realidad
  //      esperaba el primer fetch. Solución: estado "loading"
  //      dedicado con coherent visual + a11y (`role="status"`).
  if (live === undefined) {
    return "loading";
  }

  const liveDegraded = isDegradedSnapshot(live);

  // Live healthy → render live.
  if (!liveDegraded) {
    return "live";
  }

  // Phase 2 §3.39 — loading-state gap fix:
  //  Si live está degraded pero historical aún no llegó (o está
  //  loading), mantener chip HISTÓRICO (transitional) hasta que
  //  historical llegue O la query fallece definitivamente. Sin esto
  //  el chip flickerea entre estados durante el window de 1-2s del
  //  loading query, que es honest-data-integrity gap perceptible
  //  al usuario.
  //
  // §3.39 — si tanto live como historical están degradados/missing,
  // caemos a 'historical' igualmente; el chart handler detecta
  // `renderedSnap=undefined` y muestra «Sin curva horaria
  // disponible.» NO fabricamos números sintéticos.
  if (loadingHistorical || !historical) {
    return "historical";
  }

  // Live degraded + historical loaded + race-fix match → render historical.
  if (
    historical.demandCurve.length > 0 &&
    // ⚠️ Defense-in-depth `.toLowerCase()` aquí es REDUNDANTE post-§3.32
    // (LiveDemandRegion reshape: enum ahora kebab-lowercase). Lo dejamos
    // como belt-and-suspenders contra refactors futuros que metan un
    // uppercase variant al enum (el bug original §3.31 que rompía la
    // race-fix fue exactamente esto).
    historical.region?.toLowerCase() ===
      (regionSlug?.toLowerCase() ?? "nacional") &&
    historical.timestamp?.startsWith(dateYesterday)
  ) {
    return "historical";
  }

  // Phase 2 §3.39 — era `return "mock"` (auto-fallback sintético).
  // Ahora devolvemos "historical" para mantener chip coherente, y
  // dejamos que el chart renderice «Sin curva horaria disponible.»
  // dado que renderedSnap será undefined (historicalHourly no cumple
  // los 3 guards de arriba).
  return "historical";
}

export default function LiveDemandCard() {
  // Phase 2 §3.31 — state de region. Default 'nacional' (= display
  // 'Nacional' en REGIONS — alineado a `LiveDemandRegion` kebab-case).
  const [regionDisplay, setRegionDisplay] = useState<string>(REGIONS[0]); // 'Nacional'
  const region = regionDisplayToSlug(regionDisplay);

  return (
    <LiveDemandCardBody
      region={regionDisplay}
      regionSlug={region}
      onRegionChange={setRegionDisplay}
    />
  );
}

/**
 * Body de LiveDemandCard separado del wrapper para que el `region`
 * state pueda ser leído por hooks sin necesidad de props drilling.
 *
 * POR QUÉ wrapper+body split:
 *   `useLiveDemand(region)`, `useHistoricalHourly(date, region)`, y
 *   `buildMockLiveDemand(region)` requieren el slug de region. Mantenemos
 *   la state en el wrapper y la pasamos al body via props, en lugar de
 *   hacer que cada hook necesario esté en el body directamente.
 */
function LiveDemandCardBody({
  region,
  regionSlug,
  onRegionChange,
}: {
  region: string;
  regionSlug: LiveDemandRegion | undefined;
  onRegionChange: (r: string) => void;
}) {
  const { liveDemand, errorLiveDemand, refetchLiveDemand } =
    useLiveDemand(regionSlug);
  const dateYesterday = yesterdayISODate();
  const { historicalHourly, loadingHistorical } = useHistoricalHourly(
    dateYesterday,
    regionSlug,
  );
  // §3.44 Phase 2 — recharts NO acepta strings `var(--c-X)` para fill/stroke
  // (gradients canvas-internals). Resolvemos las vars a hex vía hex resolved
  // hook suscripto al MutationObserver data-theme.
  const chartTheme = useChartTheme();

  // Phase 2 §3.39 — discriminated mode (3 values) + renderedSnap
  // sin fallback mock. Si tanto live como historical están
  // degradados, `renderedSnap` queda undefined y el chart handler
  // abajo muestra «Sin curva horaria disponible.» con KPIs `—`.
  const snap = liveDemand;
  const mode = deriveMode({
    live: snap,
    historical: historicalHourly,
    loadingHistorical,
    regionSlug,
    dateYesterday,
  });

  // Recharts theme colors derived AFTER `mode` (TDZ-safe). chartLineColor
  // sigue la convención §3.39: live→cyan, historical→muted (desaturado).
  const chartLineColor =
    mode === "historical" ? chartTheme.muted : chartTheme.live;
  const chartAxisColor = chartTheme.muted;
  const chartBorderColor = chartTheme.border;

  // Final rendered snap used by chart, KPIs, footer.
  //   live       → snap limpio de REE.
  //   historical → historicalHourly (puede ser undefined si REE no
  //                 responde: el chart handler lo detecta y muestra
  //                 «Sin curva horaria disponible.»).
  //   loading    → undefined (loader estático del chart).
  const renderedSnap: LiveDemandData | undefined =
    mode === "live"
      ? snap
      : mode === "historical"
        ? historicalHourly
        : undefined;

  //Estado de error del LIVE. Aislamos el error de historical
  //(puede ser un backend transitorio) para no contaminar el ok-path.
  if (errorLiveDemand) {
    const detail = extractErrorDetail(errorLiveDemand);
    return (
      <section data-testid="live-demand-card">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <h2
            className="text-[16px] font-semibold"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}
          >
            Datos en tiempo real
          </h2>
          <RegionPills
            region={region}
            onRegionChange={onRegionChange}
            origin="error"
          />
        </div>
        <div
          className="rounded-2xl border p-5"
          style={{ background: C.surface, borderColor: C.border }}
          role="alert"
        >
          <p className="text-[14px] font-semibold" style={{ color: C.danger }}>
            Error al cargar datos en tiempo real ({region})
          </p>
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
            {detail}
          </p>
          <button
            type="button"
            onClick={() => refetchLiveDemand()}
            className="mt-3 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
            style={{ background: C.danger, color: C.textOnDanger }}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const chipSource: string | null | undefined =
    mode === "historical"
      ? (historicalHourly?.timestamp ?? null)
      : (snap?.timestamp ?? null);

  return (
    <section data-testid="live-demand-card">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2
          className="text-[16px] font-semibold"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}
        >
          Datos en tiempo real
        </h2>
        <Chip mode={mode} />
        <CurrentTime source={chipSource} />
      </div>

      <Card>
        <div className="p-5 pb-2 flex flex-wrap items-center justify-between gap-3">
          <RegionPills
            region={region}
            onRegionChange={onRegionChange}
            origin="ok"
          />
          <div className="flex items-center gap-4 text-[11.5px]">
            <span
              className="flex items-center gap-1.5"
              style={{ color: C.live }}
            >
              <span
                className="w-2.5 h-0.5"
                style={{ background: C.live }}
                aria-hidden
              />
              Demanda real
            </span>
            <span
              className="flex items-center gap-1.5"
              style={{ color: C.muted }}
            >
              <span
                className="w-2.5 h-0.5 border-t border-dashed"
                style={{ borderColor: C.muted }}
                aria-hidden
              />
              Prevista
            </span>
          </div>
        </div>

        <div className="h-[240px] px-2 pb-3" data-testid="demand-curve-chart">
          {mode === "loading" ? (
            // Phase 2 §3.32 polish (reviewer Q1.2) — sólo texto; el
            //     chip "CARGANDO" ya provee el indicador visual
            //     animado. Spinner adicional aquí sería redundante.
            <div
              className="h-full flex items-center justify-center text-[12px]"
              style={{ color: C.muted }}
              role="status"
              aria-live="polite"
              data-testid="chart-loader-initial"
            >
              Cargando datos en vivo desde apiDatos REE…
            </div>
          ) : loadingHistorical && mode === "historical" ? (
            <div
              className="h-full flex items-center justify-center text-[12px]"
              style={{ color: C.muted }}
            >
              Cargando histórico de ayer…
            </div>
          ) : (renderedSnap?.demandCurve ?? []).length === 0 ? (
            <div
              className="h-full flex items-center justify-center text-[12px]"
              style={{ color: C.muted }}
            >
              Sin curva horaria disponible.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={(renderedSnap?.demandCurve ?? []).map(
                  (p: { h: string; real: number; prevista: number }) => ({
                    ...p,
                  }),
                )}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id={GRADIENT_ID_FOR_MODE[mode]}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={chartLineColor}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="100%"
                      stopColor={chartLineColor}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="h"
                  stroke={chartAxisColor}
                  tick={{ fontSize: 11, fill: chartAxisColor }}
                  axisLine={{ stroke: chartBorderColor }}
                  tickLine={false}
                />
                <YAxis
                  stroke={chartAxisColor}
                  tick={{ fontSize: 11, fill: chartAxisColor }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    background: chartTheme.surfaceAlt,
                    border: `1px solid ${chartBorderColor}`,
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: chartAxisColor }}
                />
                <Area
                  type="monotone"
                  dataKey="prevista"
                  stroke={chartAxisColor}
                  strokeDasharray="4 4"
                  fill="none"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="real"
                  stroke={chartLineColor}
                  fill={`url(#${GRADIENT_ID_FOR_MODE[mode]})`}
                  strokeWidth={2.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-px mt-1"
          style={{ background: C.border }}
        >
          <KpiCell
            label="Demanda actual"
            value={
              (renderedSnap?.currentDemandMW ?? 0) > 0
                ? formatGW(renderedSnap?.currentDemandMW ?? 0)
                : "—"
            }
          />
          <KpiCell
            label="Máxima prevista"
            value={
              (renderedSnap?.maxForecastMW ?? 0) > 0
                ? formatGW(renderedSnap?.maxForecastMW ?? 0)
                : "—"
            }
          />
          <KpiCell
            label="Mínima del día"
            value={
              (renderedSnap?.minTodayMW ?? 0) > 0
                ? formatGW(renderedSnap?.minTodayMW ?? 0)
                : "—"
            }
          />
          <KpiCell
            label="Renovables"
            value={
              (renderedSnap?.renewablePercentageValue ?? 0) > 0
                ? formatPct(renderedSnap?.renewablePercentageValue ?? 0)
                : "—"
            }
          />
        </div>

        <div
          className="px-5 py-2 mt-1 text-[10.5px] flex items-center gap-2 flex-wrap"
          style={{ color: C.muted }}
          aria-label="Emisiones de CO₂ equivalente"
        >
          <span>Emisiones CO₂eq:</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              color:
                (renderedSnap?.co2Emissions ?? "—") === "—" ? C.muted : C.text,
            }}
          >
            {renderedSnap?.co2Emissions ?? "—"}
          </span>
          {mode === "historical" ? (
            <span style={{ marginLeft: "auto" }}>
              Curva del {formatDateShort(dateYesterday)} ({region})
            </span>
          ) : null}
        </div>
      </Card>

      <p
        className="text-[11px] text-center mt-8 mb-2"
        style={{
          color: COLOR_FOR_MODE[mode],
        }}
      >
        {CAPTION_FOR_MODE[mode]}
      </p>
    </section>
  );
}

/**
 * RegionPills — Phase 2 §3.31.
 * Pasa de `aria-hidden decorative` a botones interactivos. onClick
 * cambia el region state en `<LiveDemandCard>` wrapper.
 *
 * Accesibilidad:
 *   - `role="radiogroup"` + `role="radio"` con `aria-checked=true|false`
 *     para anunciar a screen-readers como selector (no como pills ARIA).
 *   - `tabIndex={0|−1}` para flujo de teclado coherente.
 *   - keyboard arrow navigation no implementado en este turn
 *     (out-of-scope Fase 2 §3.31; future Tier-2 polish).
 */
function RegionPills({
  region,
  onRegionChange,
  origin,
}: {
  region: string;
  onRegionChange: (r: string) => void;
  origin: "ok" | "error";
}) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-lg flex-wrap"
      style={{
        background: C.surfaceAlt,
        opacity: origin === "error" ? 0.6 : 1,
      }}
      role="radiogroup"
      aria-label="Selector de región eléctrica"
    >
      {REGIONS.map((r) => {
        const isActive = r === region;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onRegionChange(r)}
            disabled={origin === "error"}
            data-testid={`region-pill-${r.toLowerCase()}`}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-opacity hover:opacity-90 focus:outline-none"
            style={{
              background: isActive ? C.live : "transparent",
              color: isActive ? C.textOnLive : C.muted,
              cursor: origin === "error" ? "not-allowed" : "pointer",
            }}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4" style={{ background: C.surface }}>
      <div className="text-[10.5px]" style={{ color: C.muted }}>
        {label}
      </div>
      <div
        className="text-[15px] mt-1 font-medium"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          color: C.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}
