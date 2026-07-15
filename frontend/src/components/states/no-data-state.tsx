import { C } from '../../libs/design-tokens';

export default function NoDataState() {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: C.surface, borderColor: C.border }}
      data-testid="no-data-state"
      role="status"
    >
      <p className="text-[14px] font-semibold" style={{ color: C.muted }}>
        Sin datos disponibles
      </p>
      <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
        No hay datos de balance eléctrico para el rango de fechas
        seleccionado. Prueba a acortar el intervalo o cambiar los filtros.
      </p>
    </div>
  );
}
