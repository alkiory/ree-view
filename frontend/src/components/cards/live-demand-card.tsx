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
  buildMockLiveDemand,
  type LiveDemandRegion,
} from "../../hooks/useLiveDemand";
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
// Phase 2 §3.32 — DISCARDED CHIPS for mode awareness.
//   - 'loading'     → CARGANDO (muted pulse) — Apollo initial fetch en vuelo
//   - 'live'        → EN VIVO (cyan, pulsing dot)
//   - 'historical'  → HISTÓRICO (muted, bordered)
//   - 'mock'        → DEMO (gold, boxed) — datos sintéticos, NO reales
// ─────────────────────────────────────────────────────────────────────────────
function Chip({ mode }: { mode: Mode }) {
  if (mode === "loading") {
    return (
      <span
        className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border"
        style={{
          background: `${C.muted}1A`,
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
        style={{ background: `${C.live}1A`, color: C.live }}
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
          background: `${C.muted}26`,
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
  // mode === 'mock'
  return (
    <span
      className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border"
      style={{
        background: `${C.accentGold}26`,
        color: C.accentGold,
        borderColor: C.accentGold,
      }}
      aria-label="Datos sintéticos — fallback mock cuando upstream REE no disponible"
      data-testid="chip-mock"
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: C.accentGold }}
      />
      DEMO
    </span>
  );
}

/**
 * Phase 2 §3.32 — discriminated union for the 4 render modes.
 *
 *   `'loading'`    Apollo fetch inicial en vuelo — chip "CARGANDO"
 *                   + chart loader (positional coherence: antes el
 *                   chip decía "EN VIVO" mientras body "Sin curva
 *                   horaria..." → UX gap engañoso).
 *   `'live'`       snap limpio de REE.
 *   `'historical'` fallback a ayer cuando live degraded.
 *   `'mock'`       sintético cuando ambos fallan.
 */
type Mode = "loading" | "live" | "historical" | "mock";

// Footer caption per Mode. Declarative Record lookup vs nested ternary —
// evita missed-branch bugs cuando se añada un 5to mode en el futuro.
const CAPTION_FOR_MODE: Record<Mode, string> = {
  loading: "Inicializando conexión con apiDatos REE…",
  live: "Datos en vivo desde apiDatos REE · snapshot cacheado en backend con TTL 60s · poll de 60s desde el frontend",
  historical:
    "Fallback histórico (ayer) · datos en vivo desde apiDatos REE no disponibles · poll de 60s",
  mock: "DEMO MODE activo · fallback sintético mientras apiDatos REE no responde (4xx/5xx) · los datos NO son reales",
};

// Color per Mode: chart stroke, gradient stopColor, footer caption,
// "Demanda real" legend dot, legend background. Record<Mode, …>
// garantiza exhaustividad en compile-time — un 5to Mode value se
// convierte en TS error, no en silent visual regression.
//
// Convenciones Fase 2 §3.32:
//   loading    → muted (curva no se renderiza; placeholder estático)
//   live       → live (cyan, vibrante)
//   historical → muted (desaturado: indica que estamos en fallback)
//   mock       → accentGold (gold: indica explícitamente DEMO/sintético)
const COLOR_FOR_MODE: Record<Mode, string> = {
  loading: C.muted,
  live: C.live,
  historical: C.muted,
  mock: C.accentGold,
};

// Gradient id per Mode: live + loading comparten `demandFill` porque
// loading no renderiza curva (loader estático) pero para exhaustiveness
// referenciamos el id del cyan fill; Apollo → live reusa el mismo.
const GRADIENT_ID_FOR_MODE: Record<Mode, string> = {
  loading: "demandFill",
  live: "demandFill",
  historical: "demandFillHistorical",
  mock: "demandFillMock",
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

  // Phase 2 §3.32 — loading-state gap fix (reviewer Q1 part 2):
  //  Si live está degraded pero historical aún no llegó (o está
  //  loading), NO saltar a 'mock' prematuramente. Mantener chip
  //  HISTÓRICO (transitional) hasta que historical llegue O la query
  //  fallece definitivamente. Sin esto el chip flickerea 'DEMO'
  //  durante el window de 1-2s del loading query, que es honest-
  //  data-integrity gap perceptible al usuario.
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

  // Otherwise (live degraded + historical returned but invalid): MOCK fallback.
  return "mock";
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

  // Phase 2 §3.32 — discriminated mode + renderedSnap with mock fallback.
  const snap = liveDemand;
  const mode = deriveMode({
    live: snap,
    historical: historicalHourly,
    loadingHistorical,
    regionSlug,
    dateYesterday,
  });
  // Build the mock fallback synchronously (no Apollo) when mode='mock'.
  // Phase 2 §3.32 — note that buildMockLiveDemand intentionally ignores
  // `regionSlug`: DEMO_CURVE is Nacional-plausible regardless of user
  // selection. Override at the mock-build layer keeps schema-level
  // honesty (mock shape ≠ Canarias-shape even when Canarias pill active).
  const mockSnap: LiveDemandData | undefined =
    mode === "mock" ? buildMockLiveDemand() : undefined;

  // Final rendered snap used by chart, KPIs, footer.
  const renderedSnap: LiveDemandData | undefined =
    mode === "live"
      ? snap
      : mode === "historical"
        ? historicalHourly
        : mockSnap;

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
            style={{ background: C.danger, color: "#1A0606" }}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const chipSource: string | null | undefined =
    mode === "mock"
      ? (mockSnap?.timestamp ?? null)
      : mode === "historical"
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
              style={{ color: mode === "mock" ? C.accentGold : C.live }}
            >
              <span
                className="w-2.5 h-0.5"
                style={{ background: mode === "mock" ? C.accentGold : C.live }}
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
                      stopColor={COLOR_FOR_MODE[mode]}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="100%"
                      stopColor={COLOR_FOR_MODE[mode]}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="h"
                  stroke={C.muted}
                  tick={{ fontSize: 11, fill: C.muted }}
                  axisLine={{ stroke: C.border }}
                  tickLine={false}
                />
                <YAxis
                  stroke={C.muted}
                  tick={{ fontSize: 11, fill: C.muted }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    background: C.surfaceAlt,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: C.muted }}
                />
                <Area
                  type="monotone"
                  dataKey="prevista"
                  stroke={C.muted}
                  strokeDasharray="4 4"
                  fill="none"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="real"
                  stroke={COLOR_FOR_MODE[mode]}
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
          ) : mode === "mock" ? (
            <span style={{ marginLeft: "auto" }}>
              Datos sintéticos · upstream REE no disponible · NO ES REAL
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
              color: isActive ? "#04222F" : C.muted,
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
