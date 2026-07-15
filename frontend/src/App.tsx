import { useState } from 'react';
import DataSelector from './components/data-selector';
import EnergyChart from './components/energy-chart';
import { formatDate } from './libs/date-formatter';
import { C } from './libs/design-tokens';

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
      style={{ background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif" }}
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
      </div>
    </div>
  );
}
