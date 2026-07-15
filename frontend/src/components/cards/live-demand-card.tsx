import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { Card } from './primitives';
import { C, DEMAND_CURVE, REGIONS } from '../../libs/design-tokens';
import { useMockLiveDemand } from '../../libs/mocks/live-demand.mock';

const formatTime = (date: Date): string => {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

// `CurrentTime` se aísla en un sub-componente para que el 1s setInterval
// que refresca la etiqueta «Última actualización» sólo re-renderice este
// <span>, evitando que el <AreaChart> (más costoso) reciba un re-render
// por segundo.
function CurrentTime({ source }: { source: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-[11px]" style={{ color: C.muted }}>
      Última actualización · {formatTime(source)}
    </span>
  );
}

export default function LiveDemandCard() {
  // Las pills de región son puramente decorativas en esta fase (no hay
  // dataset por región todavía — ver CURRENT.md §6 Deuda Técnica). Se
  // renderizan estáticamente sin estado ni handler para evitar confusión
  // visual con un selector funcional.
  const snap = useMockLiveDemand(3000);

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
        <CurrentTime source={snap.timestamp} />
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
                  background: idx === 0 ? C.live : 'transparent',
                  color: idx === 0 ? '#04222F' : C.muted,
                }}
              >
                {r}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4 text-[11.5px]">
            <span className="flex items-center gap-1.5" style={{ color: C.live }}>
              <span
                className="w-2.5 h-0.5"
                style={{ background: C.live }}
                aria-hidden
              />
              Demanda real
            </span>
            <span className="flex items-center gap-1.5" style={{ color: C.muted }}>
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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={DEMAND_CURVE.map((p) => ({ ...p }))}
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
        </div>

        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-px mt-1"
          style={{ background: C.border }}
        >
          {[
            ['Demanda actual', snap.currentDemandGW],
            ['Máxima prevista', snap.maxForecastGW],
            ['Mínima del día', snap.minTodayGW],
            ['Emisiones CO₂eq', snap.co2Emissions],
          ].map(([label, val]) => (
            <div key={label} className="p-4" style={{ background: C.surface }}>
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
                {val}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p
        className="text-[11px] text-center mt-8 mb-2"
        style={{ color: C.muted }}
      >
        Datos ilustrativos con fines de maquetación · fuente de datos: apiDatos
        REE · la sección «en vivo» actualmente se alimenta con datos simulados
        (mock) — endpoint real pendiente para Fase 2.
      </p>
    </section>
  );
}
