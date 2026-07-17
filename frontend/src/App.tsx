import { useState } from "react";
import DataSelector from "./components/data-selector";
import EnergyChart from "./components/energy-chart";
import LiveDemandCard from "./components/cards/live-demand-card";
import MockLiveDemandCard from "./components/cards/mock-live-demand-card";
import { formatDate } from "./libs/date-formatter";
import { C } from "./libs/design-tokens";

// Phase 2 §3.39 — opt-in mock fallback para dev offline / sandbox.
// Default: `false` (prod-safe). Se activa con `VITE_ENABLE_MOCK_FALLBACK=true`
// en `.env.local` o al hacer `pnpm dev` con esa variable.
//
// Vite hace static-replace de `import.meta.env.*` en build-time:
// cuando la flag es `false`/unset, el branch de MockLiveDemandCard
// se elimina completamente del bundle (dead-code elimination).
const USE_MOCK_FALLBACK =
  import.meta.env.VITE_ENABLE_MOCK_FALLBACK === "true";

export default function App() {
  const [filters, setFilters] = useState({
    startDate: formatDate(new Date()),
    endDate: formatDate(new Date()),
    type: null as string | null,
    groupId: null as string | null,
  });

  const handleFilterChange = (newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: C.bg,
        color: C.text,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div className="max-w-[1180px] mx-auto px-6 py-8">
        <DataSelector
          onDateChange={({ start, end }) =>
            handleFilterChange({ startDate: start, endDate: end })
          }
          onGroupChange={(groupId) => handleFilterChange({ groupId })}
          onTypeChange={(type) => handleFilterChange({ type })}
        />
        <EnergyChart
          startDate={filters.startDate}
          endDate={filters.endDate}
          type={filters.type}
          groupId={filters.groupId}
        />
        {/* Phase 2 §3.39 — LiveDemandCard top-level.
            Antes vivía dentro de EnergyChart (buried under the energy
            flow). Lo movemos aquí porque (a) la data live no depende
            de los date filters del DataSelector, (b) así el branch
            Mock/Live queda en un solo lugar visible para review. */}
        {USE_MOCK_FALLBACK ? <MockLiveDemandCard /> : <LiveDemandCard />}
      </div>
      <footer
        className="text-center pb-8 pt-6 px-6 border-t"
        style={{ borderColor: C.border }}
        aria-label="Atribuciones del proyecto"
      >
        <p
          className="text-[11.5px]"
          style={{ color: C.muted, fontFamily: "'Inter', sans-serif" }}
        >
          Desarrollado por{" "}
          <a
            href="https://alkiory.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:underline"
            style={{ color: C.accentCyan }}
            data-testid="footer-alkiory"
          >
            Alkiory 👨🏽‍💻
          </a>{" "}
        </p>
      </footer>
    </div>
  );
}
