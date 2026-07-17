import { EnergyBalanceType } from "../types/energy-balance.types";

/**
 * Procesa balances crudos de la API REE y devuelve un agregado
 * separado por grupo (renovable / no-renovable) con porcentajes
 * respecto al total de su familia y al mix completo.
 */
export function processGenerationData(energyBalances: EnergyBalanceType[]) {
  const renewable: { [type: string]: { value: number; percentage: number; color?: string | null; icon?: string | null; title?: string | null } } = {};
  const nonRenewable: { [type: string]: { value: number; percentage: number; color?: string | null; icon?: string | null; title?: string | null } } = {};
  let totalRenewable = 0;
  let totalNonRenewable = 0;

  energyBalances.forEach(item => {
    const { type, groupId, attributes } = item;
    const total = attributes?.total || 0;
    const color = attributes?.color;
    const icon = attributes?.icon;
    const title = attributes?.title;

    if (groupId === 'Renovable') {
      renewable[type] = { value: (renewable[type]?.value || 0) + total, percentage: 0, color, icon, title };
      totalRenewable += total;
    } else {
      nonRenewable[type] = { value: (nonRenewable[type]?.value || 0) + total, percentage: 0, color, icon, title };
      totalNonRenewable += total;
    }
  });

  const allGeneration = totalRenewable + totalNonRenewable;
  const renewableData = Object.entries(renewable).map(([type, data]) => ({
    type,
    value: data.value,
    percentage: (data.value / totalRenewable) * 100,
    color: data.color,
    icon: data.icon,
    title: data.title,
  }));

  const nonRenewableData = Object.entries(nonRenewable).map(([type, data]) => ({
    type,
    value: data.value,
    percentage: (data.value / totalNonRenewable) * 100,
    color: data.color,
    icon: data.icon,
    title: data.title,
  }));

  const totalRenewablePercentage = (totalRenewable / allGeneration) * 100 || 0;
  const totalNonRenewablePercentage = (totalNonRenewable / allGeneration) * 100 || 0;

  return {
    renewable: renewableData,
    nonRenewable: nonRenewableData,
    totalRenewable,
    totalNonRenewable,
    totalRenewablePercentage,
    totalNonRenewablePercentage,
    totalGeneration: allGeneration,
  };
}
