/** Constantes compartidas por los DTOs del módulo `energy-balance`. */

const _rawMaxDays = Number(process.env.MAX_DATE_RANGE_DAYS);

/**
 * Máximo de días permitido entre `startDate` y `endDate` por los DTOs.
 * Configurable vía `process.env.MAX_DATE_RANGE_DAYS` (default 365).
 * Filtra `NaN`, `0` o negativos porque `Number(value) || 365` deja
 * pasar `-1` (truthy) y desactivaba silenciosamente la validación.
 */
export const MAX_DATE_RANGE_DAYS: number =
  Number.isFinite(_rawMaxDays) && _rawMaxDays > 0 ? _rawMaxDays : 365;
