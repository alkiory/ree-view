import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, SectionLabel, Leaf, Factory } from "./primitives";
import { C } from "../../libs/design-tokens";
import { useChartTheme } from "../../hooks/useChartTheme";
import { EnergyBalanceType } from "../../types/energy-balance.types";
import { processGenerationData } from "../../libs/process-generation-data";

// `isAnimationActive={false}` en DEV mitiga el doble-mount de React Strict
// Mode que produce "jitter" de animación en recharts (ver CURRENT.md §3.17
// nota complementaria sobre React 19).
const animate = (): false | undefined =>
  import.meta.env.DEV ? false : undefined;

interface LegendRowProps {
  name: string;
  pct: number;
  color: string;
}

function LegendRow({ name, pct, color }: LegendRowProps) {
  return (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="flex items-center gap-1.5" style={{ color: C.text }}>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
        {name}
      </span>
      <span
        style={{
          color: C.muted,
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

interface GenerationCardProps {
  energyBalances: EnergyBalanceType[];
}

export default function GenerationCard({
  energyBalances,
}: GenerationCardProps) {
  const generationData = processGenerationData(energyBalances);
  // §3.44 Phase 2 — recharts RadialBar/Pie fill props resueltos vía
  // useChartTheme hex resolved (see hooks/useChartTheme.ts). Sólo los
  // PRIMARY fills cambian al chartTheme.value; los fallbacks `?? C.X`
  // siguen apuntando a vars CSS para producción sin color attribute.
  const chartTheme = useChartTheme();
  const renewableShare = generationData.totalRenewablePercentage || 0;
  const nonRenewableShare = 100 - renewableShare;
  const hasRenewable = generationData.renewable.length > 0;
  const hasNonRenewable = generationData.nonRenewable.length > 0;
  const totalMWh = Math.round(generationData.totalRenewable);

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[260px_1fr_1fr] gap-4"
      data-testid="generation-card"
    >
      {/* Gauge central — Cuota renovable */}
      <Card>
        <SectionLabel icon={Leaf}>Cuota renovable</SectionLabel>
        <div className="relative h-[210px] flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="72%"
              outerRadius="100%"
              data={[{ name: "renovable", value: renewableShare }]}
              startAngle={90}
              endAngle={-270}
            >
              <RadialBar
                dataKey="value"
                cornerRadius={20}
                fill={chartTheme.renewable}
                background={{ fill: chartTheme.surfaceAlt }}
                max={100}
                isAnimationActive={animate()}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center">
            <span
              className="text-[30px] font-semibold leading-none"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                color: C.renewable,
              }}
            >
              {renewableShare.toFixed(1)}%
            </span>
            <span className="text-[10.5px] mt-1" style={{ color: C.muted }}>
              {new Intl.NumberFormat("es-ES").format(totalMWh)} MWh
            </span>
          </div>
        </div>
        <div className="px-5 pb-5 flex items-center justify-between text-[11.5px]">
          <span
            className="flex items-center gap-1.5"
            style={{ color: C.renewable }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: C.renewable }}
            />
            Renovable
          </span>
          <span
            className="flex items-center gap-1.5"
            style={{ color: C.nonRenewable }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: C.nonRenewable }}
            />
            No renovable · {nonRenewableShare.toFixed(1)}%
          </span>
        </div>
      </Card>

      {/* Donut renovable */}
      <Card>
        <SectionLabel icon={Leaf}>Generación renovable</SectionLabel>
        {hasRenewable ? (
          <div className="flex items-center gap-3 px-3 pb-4">
            <div className="w-[120px] h-[120px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={generationData.renewable}
                    dataKey="value"
                    innerRadius={38}
                    outerRadius={58}
                    paddingAngle={2}
                    isAnimationActive={animate()}
                  >
                    {generationData.renewable.map((d, i) => (
                      <Cell
                        // Production wedge path: NO use `resolveMixColor()`
                        // (Phase 2 §3.30) — production data lacks `colorIndex`.
                        // Color viene del API MongoDB `attributes.color` (REE
                        // catalog), con `renewableDim`/`nonRenewableDim` como
                        // fallback defensivo si llega null/undefined.
                        key={`${d.type}-${i}`}
                        fill={(d.color as string) ?? C.renewableDim}
                        stroke="none"
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 flex flex-col gap-1.5 py-3 pr-4">
              {generationData.renewable.slice(0, 4).map((d) => (
                <LegendRow
                  key={d.type}
                  name={d.title ?? d.type}
                  pct={d.percentage}
                  color={(d.color as string) ?? chartTheme.renewable}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="p-5 text-[12px]" style={{ color: C.muted }}>
            Sin datos de generación renovable en el rango seleccionado.
          </p>
        )}
      </Card>

      {/* Donut no renovable */}
      <Card>
        <SectionLabel icon={Factory}>Generación no renovable</SectionLabel>
        {hasNonRenewable ? (
          <div className="flex items-center gap-3 px-3 pb-4">
            <div className="w-[120px] h-[120px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={generationData.nonRenewable}
                    dataKey="value"
                    innerRadius={38}
                    outerRadius={58}
                    paddingAngle={2}
                    isAnimationActive={animate()}
                  >
                    {generationData.nonRenewable.map((d, i) => (
                      <Cell
                        // Production wedge path: NO use `resolveMixColor()`
                        // (Phase 2 §3.30) — production data lacks `colorIndex`.
                        key={`${d.type}-${i}`}
                        fill={(d.color as string) ?? C.nonRenewableDim}
                        stroke="none"
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 flex flex-col gap-1.5 py-3 pr-4">
              {generationData.nonRenewable.slice(0, 4).map((d) => (
                <LegendRow
                  key={d.type}
                  name={d.title ?? d.type}
                  pct={d.percentage}
                  color={(d.color as string) ?? chartTheme.nonRenewable}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="p-5 text-[12px]" style={{ color: C.muted }}>
            Sin datos de generación no renovable en el rango seleccionado.
          </p>
        )}
      </Card>
    </div>
  );
}
