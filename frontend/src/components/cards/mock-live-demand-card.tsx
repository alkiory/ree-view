import { Card } from "./primitives";
import { C } from "../../libs/design-tokens";
import type {
  DemandCurvePoint,
  LiveDemandData,
} from "../../hooks/useLiveDemand";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 §3.39 — MOCK FALLBACK (opt-in, isolated component).
//
// PROPÓSITO: salvavidas para desarrollo offline / sandbox sin acceso a
// apiDatos.ree.es. NUNCA se renderiza en producción a menos que el
// operador active explícitamente `VITE_ENABLE_MOCK_FALLBACK=true`.
//
// Diferencias vs §3.32 (auto-fallback dentro de LiveDemandCard):
//   1. Es un COMPONENTE separado (no un mode dentro de LiveDemandCard).
//   2. Se monta a nivel App.tsx, NO dentro del árbol de EnergyChart.
//   3. Los datos sintéticos viven DENTRO del archivo (no exportados),
//      blast radius = 1 archivo.
//   4. UI deliberadamente "DEMO": chip dorado prominente, badge
//      "DATOS SINTÉTICOS · NO REALES" en footer, sin Recharts (sólo
//      KPIs estáticos + lista textual de horas). Cero ambigüedad.
//
// Shape DEMO_CURVE (24 horas, MW): curva plausible de demanda
// española — mínimo 4-5am (~17.5 GW), pico vespertino 20h (~36 GW).
// `real === prevista` (no tenemos forecast sintético por separado).
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_CURVE: readonly DemandCurvePoint[] = [
  { h: "00h", real: 22500, prevista: 22500 },
  { h: "01h", real: 21000, prevista: 21000 },
  { h: "02h", real: 19500, prevista: 19500 },
  { h: "03h", real: 18300, prevista: 18300 },
  { h: "04h", real: 17500, prevista: 17500 },
  { h: "05h", real: 18100, prevista: 18100 },
  { h: "06h", real: 21000, prevista: 21000 },
  { h: "07h", real: 26500, prevista: 26500 },
  { h: "08h", real: 30500, prevista: 30500 },
  { h: "09h", real: 32500, prevista: 32500 },
  { h: "10h", real: 32000, prevista: 32000 },
  { h: "11h", real: 31000, prevista: 31000 },
  { h: "12h", real: 29500, prevista: 29500 },
  { h: "13h", real: 29000, prevista: 29000 },
  { h: "14h", real: 28500, prevista: 28500 },
  { h: "15h", real: 28000, prevista: 28000 },
  { h: "16h", real: 27800, prevista: 27800 },
  { h: "17h", real: 28500, prevista: 28500 },
  { h: "18h", real: 30500, prevista: 30500 },
  { h: "19h", real: 33500, prevista: 33500 },
  { h: "20h", real: 36000, prevista: 36000 },
  { h: "21h", real: 34500, prevista: 34500 },
  { h: "22h", real: 30000, prevista: 30000 },
  { h: "23h", real: 25500, prevista: 25500 },
] as readonly DemandCurvePoint[];

const formatGW = (mw: number): string => `${(mw / 1000).toFixed(1)} GW`;

function buildMockSnap(): LiveDemandData {
  const reals = DEMO_CURVE.map((p) => p.real);
  const max = Math.max(...reals);
  const min = reals.reduce(
    (acc, r) => Math.min(acc, r),
    Number.POSITIVE_INFINITY,
  );
  const currentMW = DEMO_CURVE[DEMO_CURVE.length - 1]?.real ?? 25000;
  return {
    currentDemandMW: currentMW,
    maxForecastMW: max,
    minTodayMW: min,
    renewablePercentageValue: 45,
    timestamp: new Date().toISOString(),
    region: "NACIONAL",
    demandCurve: DEMO_CURVE.map((p) => ({ ...p })),
    co2Emissions: "142 gCO₂eq/kWh",
  };
}

export default function MockLiveDemandCard() {
  const snap = buildMockSnap();

  return (
    <section data-testid="mock-live-demand-card">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2
          className="text-[16px] font-semibold"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}
        >
          Datos en tiempo real
        </h2>
        <span
          className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold border"
          style={{
            background: `${C.accentGold}26`,
            color: C.accentGold,
            borderColor: C.accentGold,
          }}
          aria-label="Datos sintéticos — modo demo opt-in"
          data-testid="chip-mock"
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: C.accentGold }}
          />
          DEMO
        </span>
        <span
          className="text-[11px]"
          style={{ color: C.muted }}
          data-testid="mock-source-timestamp"
        >
          Generado en cliente · {new Date(snap.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <Card>
        <div className="p-5 pb-3">
          <div
            className="rounded-lg px-4 py-3 mb-4 border"
            style={{
              background: `${C.accentGold}14`,
              borderColor: `${C.accentGold}55`,
            }}
            role="status"
            data-testid="mock-banner"
          >
            <p
              className="text-[12px] font-semibold"
              style={{ color: C.accentGold }}
            >
              ⚠ MOCK MODE activo
            </p>
            <p
              className="text-[11px] mt-1"
              style={{ color: C.muted }}
            >
              <code style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                VITE_ENABLE_MOCK_FALLBACK=true
              </code>{" "}
              está activado. Los datos mostrados son SINTÉTICOS y NO
              provienen de apiDatos.ree.es. Desactiva la variable de
              entorno para volver a datos reales.
            </p>
          </div>

          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-px mb-4"
            style={{ background: C.border }}
          >
            <KpiCell label="Demanda actual" value={formatGW(snap.currentDemandMW)} />
            <KpiCell label="Máxima prevista" value={formatGW(snap.maxForecastMW)} />
            <KpiCell label="Mínima del día" value={formatGW(snap.minTodayMW)} />
            <KpiCell
              label="Renovables"
              value={`${snap.renewablePercentageValue.toFixed(1)}%`}
            />
          </div>

          <div
            className="text-[11px] mb-2 uppercase tracking-[0.1em]"
            style={{ color: C.muted }}
          >
            Curva sintética (24h, en GW)
          </div>
          <div
            className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-12 gap-x-3 gap-y-1 text-[11px]"
            data-testid="mock-curve-list"
          >
            {snap.demandCurve.map((p) => (
              <div
                key={p.h}
                className="flex justify-between gap-1"
                style={{ color: C.text }}
              >
                <span style={{ color: C.muted }}>{p.h}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {(p.real / 1000).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="px-5 py-3 text-[10.5px] flex items-center gap-2 border-t"
          style={{
            color: C.accentGold,
            borderColor: C.border,
            background: `${C.accentGold}0D`,
          }}
          data-testid="mock-footer"
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: C.accentGold }}
            aria-hidden
          />
          <span style={{ fontWeight: 600 }}>
            DATOS SINTÉTICOS · NO SON REALES · sólo para desarrollo offline
          </span>
        </div>
      </Card>
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
