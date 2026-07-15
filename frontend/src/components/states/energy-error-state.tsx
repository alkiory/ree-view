import { C } from '../../libs/design-tokens';
import { extractErrorDetail } from '../../libs/extract-error-detail';

interface EnergyErrorStateProps {
  // ApolloError se tipa como `any` aquí porque expone un `__typename` interno
  // problemático para `JSON.stringify` (ver CURRENT.md §3.4 — sólo usamos
  // campos serializables: name, message, graphQLErrors, networkError).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any;
  refetch: () => void;
}

export default function EnergyErrorState({ error, refetch }: EnergyErrorStateProps) {
  // Detalle accionable: cadena de extracción con prioridad para
  // `extensions.originalError.message` (donde Apollo guarda el motivo
  // real cuando Nest envuelve BadRequestException). Antes sólo leíamos
  // `graphQLErrors[0].message`, que en ese caso es "Bad Request Exception"
  // — opaco. Investigación bug B — propuesta §1.2 + §2.3.
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
      {/* Wrap onClick en arrow explícita (no `onClick={refetch}`) — React
          pasa el SyntheticEvent como primer argumento y Apollo lo
          interpretaría como `variables` del refetch → canonicalStringify
          del MouseEvent → cycle React fiber → DOM element → Uncaught
          TypeError: Converting circular structure to JSON.
          Ver CURRENT.md §3.13. */}
      <button
        type="button"
        onClick={() => refetch()}
        className="mt-3 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
        style={{ background: C.danger, color: '#1A0606' }}
      >
        Reintentar
      </button>
    </div>
  );
}
