import { CalendarDays, Zap } from "./primitives";
import { C } from "../../libs/design-tokens";

interface DashboardHeaderProps {
  startDate: string; // ISO 'YYYY-MM-DD'
  endDate: string; // ISO 'YYYY-MM-DD'
}

const formatES = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
};

export default function DashboardHeader({
  startDate,
  endDate,
}: DashboardHeaderProps) {
  const formatted =
    startDate === endDate
      ? formatES(startDate)
      : `${formatES(startDate)} al ${formatES(endDate)}`;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 mb-7"
      data-testid="dashboard-header"
    >
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${C.renewable}, ${C.live})`,
          }}
        >
          {/* Phase 2 §3.30 cleanup: hex literal → C.bg token ref. */}
          <Zap size={19} color={C.bg} strokeWidth={2.5} />
        </div>
        <div>
          <h1
            className="text-[19px] font-semibold tracking-tight"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: C.text }}
          >
            Balance eléctrico nacional
          </h1>
          <p className="text-[12px]" style={{ color: C.muted }}>
            Datos del sistema eléctrico español · fuente REE
          </p>
        </div>
      </div>
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-medium"
        style={{ borderColor: C.border, color: C.muted }}
      >
        <CalendarDays size={13} />
        Del {formatted}
      </div>
    </div>
  );
}
