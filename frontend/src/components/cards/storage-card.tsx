import { Card, SectionLabel, Battery } from './primitives';
import { C } from '../../libs/design-tokens';

interface StorageItem {
  label: string;
  value: string; // ya formateado, p.ej. '11,657' o '0'
  positive?: boolean; // false => rojo (consumo bombeo etc.)
}

const STORAGE_ITEMS: readonly StorageItem[] = [
  { label: 'Turbinación bombeo', value: '0' },
  { label: 'Consumo bombeo', value: '0', positive: false },
  { label: 'Entrega batería', value: '0' },
  { label: 'Carga batería', value: '0', positive: false },
];

export default function StorageCard() {
  // Decisión: el cálculo real desde `fronteraDataResponse.getIntercambios`
  // queda pendiente para Fase 2 — actualmente todos los valores muestran 0
  // con tipografía monoespaciada. La firma visual sigue el mockup aprobado.
  return (
    <Card data-testid="storage-card">
      <SectionLabel icon={Battery}>Almacenamiento</SectionLabel>
      <div className="p-5 grid grid-cols-2 gap-3">
        {STORAGE_ITEMS.map((item) => (
          <div
            key={item.label}
            className="rounded-xl p-3"
            style={{ background: C.surfaceAlt }}
          >
            <div className="text-[10.5px]" style={{ color: C.muted }}>
              {item.label}
            </div>
            <div
              className="text-[15px] mt-1"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                color: item.positive === false ? C.danger : C.text,
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
      <p
        className="px-5 pb-5 text-[10.5px]"
        style={{ color: C.muted }}
      >
        Próximamente · datos completos cuando el endpoint de almacenamiento esté
        disponible (pendiente Fase 2).
      </p>
    </Card>
  );
}
