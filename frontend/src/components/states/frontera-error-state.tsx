import { C } from '../../libs/design-tokens';
import { extractErrorDetail } from '../../libs/extract-error-detail';

interface FronteraErrorStateProps {
  // ApolloError se tipa como `any` aquí porque expone un `__typename` interno
  // problemático para `JSON.stringify` (ver CURRENT.md §3.4).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  refetch: () => void;
}

export default function FronteraErrorState({ error, refetch }: FronteraErrorStateProps) {
  // Detalle accionable: la cadena completa vive en `extractErrorDetail`
  // (priority 1: extensions.originalError.message — donde Apollo guarda
  // el motivo real cuando Nest envuelve BadRequestException).
  // Investigación bug B — propuesta §1.2 + §2.3.
  const detail = extractErrorDetail(error);
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: C.surface, borderColor: C.border }}
      data-testid="frontera-error-state"
      role="alert"
    >
      <p className="text-[14px] font-semibold" style={{ color: C.danger }}>
        Error al cargar datos de fronteras
      </p>
      <p className="mt-2 text-[12px]" style={{ color: C.muted }}>
        {detail}
      </p>
      {/* Ver CURRENT.md §3.13 — nunca `onClick={refetch}` (cycle Apollo). */}
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
