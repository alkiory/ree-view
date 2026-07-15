import { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// Tipos canónicos de groupId; deben coincidir con lo que devuelve la API
// de REE y con lo que mapea processGenerationData en el frontend.
export type EnergyGroupId = 'Renovable' | 'No-Renovable';

// Mapped types con `readonly [K in T]: V` triggerean un quirk en el parser
// de SWC (usado por @vitejs/plugin-react-swc) — `Expected ']', got 'in'`.
// Forma explícita, estructuralmente equivalente y 100% compatible con
// tsc + swc + babel.
interface EnergyTypes {
  Renovable: Array<{ id: string; name: string }>;
  'No-Renovable': Array<{ id: string; name: string }>;
}

// El `id` aquí debe ser el `groupId` canónico que devuelve la API de REE
// y se persiste en MongoDB. El tipo `EnergyGroupId` se exporta para
// reutilizarlo en otros componentes que comparen strings.
const energyGroups: ReadonlyArray<{ id: EnergyGroupId; name: string }> = [
  { id: 'Renovable', name: 'Renovable' },
  { id: 'No-Renovable', name: 'No renovable' },
];

const energyTypes: EnergyTypes = {
  'Renovable': [
    { id: 'eolica', name: 'Eólica' },
    { id: 'hidraulica', name: 'Hidráulica' },
    { id: 'solar', name: 'Solar' },
    { id: 'termica', name: 'Termica' },
  ],
  'No-Renovable': [
    { id: 'nuclear', name: 'Nuclear' },
    { id: 'carbon', name: 'Carbón' },
    { id: 'ciclo-combinado', name: 'Ciclo Combinado' },
    { id: 'gas', name: 'Gas' },
    { id: 'petroleo', name: 'Petróleo' },
  ],
};

export default function DataSelector({
  onDateChange,
  onGroupChange,
  onTypeChange,
}: {
  onDateChange: ({ start, end }: { start: string; end: string }) => void;
  onGroupChange: (groupId: string | null) => void;
  onTypeChange: (type: string | null) => void;
}) {
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [endDate, setEndDate] = useState<Date>(new Date());
  // Estado como `string` porque los elementos <select> siempre emiten string.
  // El narrowing a `EnergyGroupId | ''` se hace en handleApply con guard.
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');

  const handleGroupChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedGroup(e.target.value);
    setSelectedType(''); // Reset the type when the group changes
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedType(e.target.value);
  };

  // Guard: confirma que el string del select es uno de los IDs canónicos
  // antes de estrechar a `EnergyGroupId`. Devuelve `null` para el valor "".
  const toGroupIdOrNull = (value: string): EnergyGroupId | null => {
    if (value === 'Renovable' || value === 'No-Renovable') return value;
    return null;
  };

  const handleApply = () => {
    onDateChange({
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
    });
    onGroupChange(toGroupIdOrNull(selectedGroup));
    onTypeChange(selectedType === '' ? null : selectedType);
  };

  return (
    <div className="data-selector bg-white p-4 rounded-lg shadow-md">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Start Date</label>
          <DatePicker
            selected={startDate}
            onChange={(date: Date | null) => date && setStartDate(date)}
            selectsStart
            startDate={startDate}
            endDate={endDate}
            className="border p-2 rounded w-full bg-slate-200"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">End Date</label>
          <DatePicker
            selected={endDate}
            onChange={(date: Date | null) => date && setEndDate(date)}
            selectsEnd
            startDate={startDate}
            endDate={endDate}
            minDate={startDate}
            className="border p-2 rounded w-full bg-slate-200"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Group type</label>
          <select
            value={selectedGroup || ''}
            onChange={handleGroupChange}
            className="border p-2 rounded w-full bg-slate-200"
          >
            <option value="">All</option>
            {energyGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            value={selectedType || undefined}
            onChange={handleTypeChange}
            disabled={!selectedGroup}
            className={`border p-2 rounded w-full ${!selectedGroup ? 'bg-gray-300 cursor-help' : 'bg-slate-200'}`}
          >
            <option value="">All</option>
            {selectedGroup && energyTypes[selectedGroup as EnergyGroupId]?.map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={handleApply}
        className="mt-4 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition"
      >
        Apply Filters
      </button>
    </div>
  );
}