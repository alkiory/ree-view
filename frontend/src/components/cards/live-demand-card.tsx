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
import useLiveDemand from "../../hooks/useLiveDemand";
import { extractErrorDetail } from "../../libs/extract-error-detail";

const formatTime = (date: Date): string => {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

export default function LiveDemandCard() {
  // Las pills de región son puramente decorativas en esta fase (no hay
  // dataset por región todavía — ver CURRENT.md §6 Deuda Técnica). Se
  // renderizan estáticamente sin estado ni handler para evitar confusión
  // visual con un selector funcional.
  const { liveDemand, errorLiveDemand, refetchLiveDemand } = useLiveDemand();

  // Estado de error dedicado (Apollo entrega `error` cuando el último
  // poll falló). Usa `extractErrorDetail` (§3.23 CURRENT.md) para
  // mostrar el mensaje accionable de Nest (no el opaco
  // "Failed to fetch energy data") cuando REE esté caído.
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
        </div>
        <div
          className="rounded-2xl border p-5"
          style={{ background: C.surface, borderColor: C.border }}
          role="alert"
        >
          <p className="text-[14px] font-semibold" style={{ color: C.danger }}>
            Error al cargar datos en tiempo real
          </p>
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
            {detail}
          </p>
          {/* Wrap en arrow (no `onClick={refetchLiveDemand}`) — mismo
              footgun que §3.13 CURRENT.md. */}
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

  const snap = liveDemand;
  const timestamp = snap?.timestamp ?? new Date().toISOString();
  const demandCurve = snap?.demandCurve ?? [];
  // Mientras Apollo no responde (`loading=true` y `snap=undefined`),
  // renderizamos la «estructura» de la card con KPIs vacíos. La zona
  // del chart se mantiene sin renderizar el `AreaChart` porque un data
  // vacío produciría un eje Y con un solo punto confuso.
  const currentMW = snap?.currentDemandMW ?? 0;
  const maxForecastMW = snap?.maxForecastMW ?? 0;
  const minTodayMW = snap?.minTodayMW ?? 0;
  const renewablePct = snap?.renewablePercentageValue ?? 0;
  const co2Emissions = snap?.co2Emissions ?? "—";

  return (
    <section data-testid="live-demand-card">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2
          className="text-[16px] font-semibold"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}
        >
          Datos en tiempo real
        </h2>
        <span
          className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold"
          style={{ background: `${C.live}1A`, color: C.live }}
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
        <CurrentTime source={timestamp} />
      </div>

      <Card>
        <div className="p-5 pb-2 flex flex-wrap items-center justify-between gap-3">
          {/* Region pills: puramente decorativas. Conjunto de datos por
              región pendiente para Fase 2 — no hay onClick ni estado. */}
          <div
            className="flex items-center gap-1 p-1 rounded-lg flex-wrap"
            style={{ background: C.surfaceAlt, opacity: 0.6 }}
            aria-hidden="true"
            title="Selector de región: datos por región pendientes para Fase 2"
          >
            {REGIONS.map((r, idx) => (
              <span
                key={r}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium"
                style={{
                  background: idx === 0 ? C.live : "transparent",
                  color: idx === 0 ? "#04222F" : C.muted,
                }}
              >
                {r}
              </span>
            ))}
          </div>
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

        <div className="h-[240px] px-2 pb-3">
          {demandCurve.length === 0 ? (
            <div
              className="h-full flex items-center justify-center text-[12px]"
              style={{ color: C.muted }}
            >
              {snap ? "Sin curva horaria disponible." : "Cargando…"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={demandCurve.map(
                  (p: { h: string; real: number; prevista: number }) => ({
                    ...p,
                  }),
                )}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.live} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.live} stopOpacity={0} />
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
                  stroke={C.live}
                  fill="url(#demandFill)"
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
          <KpiCell label="Demanda actual" value={formatGW(currentMW)} />
          <KpiCell label="Máxima prevista" value={formatGW(maxForecastMW)} />
          <KpiCell
            label="Mínima del día"
            value={minTodayMW > 0 ? formatGW(minTodayMW) : "—"}
          />
          <KpiCell
            label="Renovables"
            value={renewablePct > 0 ? formatPct(renewablePct) : "—"}
          />
        </div>

        <div
          className="px-5 py-2 mt-1 text-[10.5px] flex items-center gap-2"
          style={{ color: C.muted }}
          aria-label="Emisiones de CO₂ equivalente"
        >
          <span>Emisiones CO₂eq:</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              color: co2Emissions === "—" ? C.muted : C.text,
            }}
          >
            {co2Emissions}
          </span>
        </div>
      </Card>

      <p
        className="text-[11px] text-center mt-8 mb-2"
        style={{ color: C.muted }}
      >
        Datos en vivo desde apiDatos REE · snapshot cacheado en backend con TTL
        60s · poll de 60s desde el frontend
      </p>
    </section>
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
