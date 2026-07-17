import useEnergyData from '../hooks/useEnergyData';
import useFronteraData from '../hooks/useFronteraData';
import { processGenerationData } from '../libs/process-generation-data';
import { EnergyBalanceType } from '../types/energy-balance.types';
import { FronteraType, InternationalExchangesProps } from '../types/frontera.type';
import EnergyErrorState from './states/energy-error-state';
import FronteraErrorState from './states/frontera-error-state';
import LoadingState from './states/loading-state';
import NoDataState from './states/no-data-state';
import DashboardHeader from './cards/dashboard-header';
import KpiRow from './cards/kpi-row';
import GenerationCard from './cards/generation-card';
import ExchangeCard from './cards/exchange-card';
import StorageCard from './cards/storage-card';

interface EnergyChartProps {
  startDate: string;
  endDate: string;
  type?: string | null;
  groupId?: string | null;
  groupType?: string | null;
}

interface DerivedState {
  totalGenerationGWh: number;
  averageDemandGWh: number;
  internationalExchanges: InternationalExchangesProps['internationalExchanges'];
  saldoTotal: number;
}

/**
 * Convierte balances crudos en agregados reusables por las cards
 * inferiores. Se ejecuta una sola vez por render para no repetir
 * trabajo en cada card hijo.
 */
function buildDerived(
  balances: EnergyBalanceType[],
  intercambios: FronteraType[],
): DerivedState {
  const generationData = processGenerationData(balances);
  const totalGenerationGWh =
    (generationData.totalRenewable + generationData.totalNonRenewable) / 1000;
  const averageDemandGWh =
    balances.length === 0
      ? 0
      : balances.reduce((acc, b) => acc + (b.attributes?.total ?? 0), 0) /
        balances.length /
        1000;

  const internationalExchanges: InternationalExchangesProps['internationalExchanges'] = {};
  let saldoTotal = 0;
  intercambios.forEach((item) => {
    const country = item.country;
    if (!internationalExchanges[country]) {
      internationalExchanges[country] = { import: 0, export: 0 };
    }
    const total = item.attributes?.total ?? 0;
    if (item.type === 'Importación') {
      internationalExchanges[country].import += total;
    } else if (item.type === 'Exportación') {
      internationalExchanges[country].export += total;
    } else if (item.type === 'saldo') {
      saldoTotal += total;
    }
  });
  internationalExchanges.saldoInternacional = { import: 0, export: saldoTotal };

  return { totalGenerationGWh, averageDemandGWh, internationalExchanges, saldoTotal };
}

export default function EnergyChart({
  startDate,
  endDate,
  type,
  groupId,
  groupType,
}: EnergyChartProps) {
  const {
    loadingEnergy,
    errorEnergy,
    energyData,
    refetchEnergy,
  } = useEnergyData(startDate, endDate, groupId, type, groupType);
  const {
    loadingFrontera,
    errorFrontera,
    fronteraDataResponse,
    refetchFrontera,
  } = useFronteraData(startDate, endDate);

  if (loadingEnergy || loadingFrontera) return <LoadingState />;
  if (errorEnergy) return <EnergyErrorState error={errorEnergy} refetch={refetchEnergy} />;
  if (errorFrontera) return <FronteraErrorState error={errorFrontera} refetch={refetchFrontera} />;
  if (energyData === null) return <NoDataState />;

  const balances = energyData?.getEnergyBalances ?? [];
  const intercambios = fronteraDataResponse?.getIntercambios ?? [];
  const { totalGenerationGWh, averageDemandGWh, internationalExchanges, saldoTotal } =
    buildDerived(balances, intercambios);

  return (
    <div data-testid="energy-chart">
      <DashboardHeader startDate={startDate} endDate={endDate} />
      <KpiRow
        totalGenerationGWh={totalGenerationGWh}
        averageDemandGWh={averageDemandGWh}
        saldoInternacional={saldoTotal}
      />
      <GenerationCard energyBalances={balances} />
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 mb-10 mt-6">
        <ExchangeCard
          internationalExchanges={internationalExchanges}
          saldoTotal={saldoTotal}
        />
        <StorageCard />
      </div>
    </div>
  );
}
