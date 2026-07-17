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
  return iso.split("T")[0]?.split("-").reverse().join("/") ?? iso;
};

const formatGW = (mw: number): string => `${(mw / 1000).toFixed(1)} GW`;
const formatPct = (pct: number): string => `${pct.toFixed(1)}%`;

/**
 * Sub-componente aislado para que el setInterval de 1s que refresca la
 * etiqueta «Última actualización» sólo re-renderice este `<span>` sin
 * afectar el `<AreaChart>`. `source` es ISO string para que
 * React.memo no re-renderice cuando el refetch entrega el mismo
 * timestamp.
 */
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

/**
 * Modo de render del card, según el estado del live snapshot.
 * `loading`   → Apollo fetch inicial en vuelo.
 * `live`      → snap limpio de REE.
 * `historical`→ fallback a ayer cuando live degraded.
 */
type Mode = "loading" | "live" | "historical";

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

const CAPTION_FOR_MODE: Record<Mode, string> = {
  loading: "Inicializando conexión con apiDatos REE…",
  live: "Datos en vivo desde apiDatos REE · snapshot cacheado en backend con TTL 60s · poll de 60s desde el frontend",
  historical:
    "Fallback histórico (ayer) · datos en vivo desde apiDatos REE no disponibles · poll de 60s",
};

/** Color por Mode: chart stroke, gradient stopColor, footer caption, legend dot. */
const COLOR_FOR_MODE: Record<Mode, string> = {
  loading: C.muted,
  live: C.live,
  historical: C.muted,
};

/** Gradient id por Mode: live + loading comparten `demandFill`. */
const GRADIENT_ID_FOR_MODE: Record<Mode, string> = {
  loading: "demandFill",
  live: "demandFill",
  historical: "demandFillHistorical",
};

/**
 * Deriva el Mode actual. `loading` mientras Apollo no ha resuelto.
 * `historical` si live degraded (incluso si historical vacío: claro y
 * honesto, sin fabricar números). `live` si live healthy.
 */
function deriveMode(args: {
  live: LiveDemandData | undefined;
  historical: LiveDemandData | undefined;
  loadingHistorical: boolean;
  regionSlug: LiveDemandRegion | undefined;
  dateYesterday: string;
}): Mode {
  const { live, historical, loadingHistorical, regionSlug, dateYesterday } =
    args;

  if (live === undefined) {
    return "loading";
  }

  const liveDegraded = isDegradedSnapshot(live);

  if (!liveDegraded) {
    return "live";
  }

  if (loadingHistorical || !historical) {
    return "historical";
  }

  if (
    historical.demandCurve.length > 0 &&
    historical.region?.toLowerCase() ===
      (regionSlug?.toLowerCase() ?? "nacional") &&
    historical.timestamp?.startsWith(dateYesterday)
  ) {
    return "historical";
  }

  return "historical";
}

export default function LiveDemandCard() {
  const [regionDisplay, setRegionDisplay] = useState<string>(REGIONS[0]);
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
 * Body separado del wrapper para que `region` sea leído por hooks
 * directamente sin props drilling.
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
  const chartTheme = useChartTheme();

  const snap = liveDemand;
  const mode = deriveMode({
    live: snap,
    historical: historicalHourly,
    loadingHistorical,
    regionSlug,
    dateYesterday,
  });

  const chartLineColor =
    mode === "historical" ? chartTheme.muted : chartTheme.live;
  const chartAxisColor = chartTheme.muted;
  const chartBorderColor = chartTheme.border;

  const renderedSnap: LiveDemandData | undefined =
    mode === "live"
      ? snap
      : mode === "historical"
        ? historicalHourly
        : undefined;

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
 * Selector de región eléctrica. Implementado como `role="radiogroup"`
 * con `aria-checked` para anuncio accesible a screen-readers.
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
