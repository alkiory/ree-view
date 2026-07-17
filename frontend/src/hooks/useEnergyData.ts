/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from '@apollo/client';
import { GET_ENERGY_DATA } from '../queries/energy-balance.query';
import { EnergyBalanceType, QueryVariables } from '../types/energy-balance.types';

interface UseEnergyDataResult {
  loadingEnergy: boolean;
  errorEnergy: any;
  energyData: { getEnergyBalances: EnergyBalanceType[] } | undefined;
  refetchEnergy: (variables?: QueryVariables) => Promise<any>;
}

const useEnergyData = (
  startDate: string,
  endDate: string,
  groupId?: string | null,
  type?: string | null,
  groupType?: string | null,
): UseEnergyDataResult => {
  const {
    loading: loadingEnergy,
    error: errorEnergy,
    data: energyData,
    refetch: refetchEnergy,
  } = useQuery<{ getEnergyBalances: EnergyBalanceType[] }, QueryVariables>(
    GET_ENERGY_DATA,
    {
      variables: {
        input: {
          startDate,
          endDate,
          ...(groupId && { groupId }),
          ...(type && { type }),
          ...(groupType && { groupType }),
        },
      },
      onError: (error) => {
        console.error('GraphQL Error (Energy):', {
          name: error?.name,
          message: error?.message,
          graphQLErrors: error?.graphQLErrors?.map?.((e: any) => e?.message),
          networkError: (error?.networkError as Error | undefined)?.message,
        });
      },
      errorPolicy: 'all',
    },
  );

  return { loadingEnergy, errorEnergy, energyData, refetchEnergy };
};

export default useEnergyData;
