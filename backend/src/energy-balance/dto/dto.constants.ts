/**
 * Constantes compartidas por los DTOs del módulo `energy-balance`.
 * Single source of truth — elimina la duplicación que existía entre
 * `EnergyBalanceInput` y `FronteraInput` (DRY, revisión §LOW).
 *
 * Si en el futuro hay más caps u options compartidos entre DTOs del
 * módulo, agrégalos aquí (ej. `MIN_DATE_RANGE_DAYS`, regex adicionales,
 * tamaño máximo de strings, etc.).
 */

const _rawMaxDays = Number(process.env.MAX_DATE_RANGE_DAYS);

/**
 * Máximo de días permitido entre `startDate` y `endDate` por los DTOs.
 * Configurable vía `process.env.MAX_DATE_RANGE_DAYS`. El default 365
 * está alineado con `backend/.env.example` y es suficiente para los
 * dashboards de análisis histórico del frontend.
 *
 * Safety guard: NaN, 0 o valores negativos caen al default. La forma
 * naive `Number(env) || 365` deja pasar `-1` (que es truthy) y eso
 * desactivaba silenciosamente la validación porque
 * `IsMaxDaysRange(-1)` ⇒ `diffDays <= -1` es siempre true. Aquí
 * exigimos explícitamente `> 0` para impedirlo.
 */
export const MAX_DATE_RANGE_DAYS: number =
  Number.isFinite(_rawMaxDays) && _rawMaxDays > 0 ? _rawMaxDays : 365;
