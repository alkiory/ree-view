import { KPI, Zap, Gauge, ArrowLeftRight, Battery } from "./primitives";
import { C, SPARK_SYNTHETIC } from "../../libs/design-tokens";

interface KpiRowProps {
  totalGenerationGWh: number;
  averageDemandGWh: number;
  saldoInternacional: number;
}

const numberFmt = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

export default function KpiRow({
  totalGenerationGWh,
  averageDemandGWh,
  saldoInternacional,
}: KpiRowProps) {
  const totalTWh = (totalGenerationGWh / 1000).toFixed(2);
  const totalMWh = Math.round(totalGenerationGWh * 1000);
  const avgMWh = Math.round(averageDemandGWh * 1000);

  return (
    <div className="flex flex-wrap gap-4 mb-6" data-testid="kpi-row">
      <KPI
        icon={Zap}
        label="Generación total"
        value={totalTWh}
        unit="TWh"
        accent={C.accentCyan}
        sub={`${numberFmt.format(totalMWh)} MWh`}
        spark={SPARK_SYNTHETIC.generation}
      />
      <KPI
        icon={Gauge}
        label="Demanda (b.c.)"
        value={averageDemandGWh.toFixed(1)}
        unit="GWh"
        accent={C.accentPurple}
        sub={`${numberFmt.format(avgMWh)} MWh`}
        spark={SPARK_SYNTHETIC.demand}
      />
      <KPI
        icon={ArrowLeftRight}
        label="Saldo internacional"
        value={saldoInternacional.toFixed(1)}
        unit="GWh"
        accent={saldoInternacional < 0 ? C.danger : C.renewable}
        sub={
          saldoInternacional < 0
            ? "Importa menos de lo que exporta"
            : saldoInternacional > 0
              ? "Neto importador"
              : "Equilibrio"
        }
        spark={SPARK_SYNTHETIC.balance}
      />
      <KPI
        icon={Battery}
        label="Saldo almacenamiento"
        value="—"
        unit="GWh"
        accent={C.accentGold}
        sub="Próximamente"
        spark={SPARK_SYNTHETIC.storage}
      />
    </div>
  );
}
