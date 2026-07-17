import { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { C } from '../libs/design-tokens';

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
  Renovable: [
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

interface DataSelectorProps {
  onDateChange: ({ start, end }: { start: string; end: string }) => void;
  onGroupChange: (groupId: string | null) => void;
  onTypeChange: (type: string | null) => void;
}

export default function DataSelector({
  onDateChange,
  onGroupChange,
  onTypeChange,
}: DataSelectorProps) {
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

  // ── VISUAL ÚNICAMENTE. Lógica / mapping / narrowing preservados ─────────────
  return (
    <div
      className="rounded-2xl border p-5 mb-6"
      style={{ background: C.surface, borderColor: C.border }}
      data-testid="data-selector"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10.5px] font-medium uppercase tracking-wide"
            style={{ color: C.muted }}
          >
            Fecha de inicio
          </label>
          <DatePicker
            selected={startDate}
            onChange={(date: Date | null) => date && setStartDate(date)}
            selectsStart
            startDate={startDate}
            endDate={endDate}
            dateFormat="dd/MM/yyyy"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10.5px] font-medium uppercase tracking-wide"
            style={{ color: C.muted }}
          >
            Fecha de fin
          </label>
          <DatePicker
            selected={endDate}
            onChange={(date: Date | null) => date && setEndDate(date)}
            selectsEnd
            startDate={startDate}
            endDate={endDate}
            minDate={startDate}
            dateFormat="dd/MM/yyyy"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10.5px] font-medium uppercase tracking-wide"
            style={{ color: C.muted }}
          >
            Tipo de energía
          </label>
          <select
            value={selectedGroup || ''}
            onChange={handleGroupChange}
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              color: C.text,
            }}
          >
            <option value="">Todas</option>
            {energyGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10.5px] font-medium uppercase tracking-wide"
            style={{ color: C.muted }}
          >
            Tecnología
          </label>
          <select
            value={selectedType || undefined}
            onChange={handleTypeChange}
            disabled={!selectedGroup}
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none disabled:opacity-50"
            style={{
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              color: C.text,
            }}
          >
            <option value="">Todas</option>
            {selectedGroup &&
              energyTypes[selectedGroup as EnergyGroupId]?.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={handleApply}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: C.renewable, color: C.textOnRenewable }}
        >
          Aplicar filtros
        </button>
      </div>
    </div>
  );
}
