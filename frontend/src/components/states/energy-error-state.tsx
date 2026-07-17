import { C } from '../../libs/design-tokens';
import { extractErrorDetail } from '../../libs/extract-error-detail';

interface EnergyErrorStateProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  refetch: () => void;
}

export default function EnergyErrorState({ error, refetch }: EnergyErrorStateProps) {
  const detail = extractErrorDetail(error);
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: C.surface, borderColor: C.border }}
      data-testid="energy-error-state"
      role="alert"
    >
      <p className="text-[14px] font-semibold" style={{ color: C.danger }}>
        Error al cargar datos energéticos
      </p>
      <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
        {detail}
      </p>
      <button
        type="button"
        onClick={() => refetch()}
        className="mt-3 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
        style={{ background: C.danger, color: C.textOnDanger }}
      >
        Reintentar
      </button>
    </div>
  );
}
