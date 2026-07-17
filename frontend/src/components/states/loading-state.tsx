import { C } from "../../libs/design-tokens";

interface LoadingStateProps {
  message?: string;
}

export default function LoadingState({
  message = "Cargando datos…",
}: LoadingStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 h-64"
      role="status"
      aria-live="polite"
      data-testid="loading-state"
    >
      <div className="loading-spinner" />
      <p className="text-[12px]" style={{ color: C.muted }}>
        {message}
      </p>
    </div>
  );
}
