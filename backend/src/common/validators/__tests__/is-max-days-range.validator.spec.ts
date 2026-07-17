import { validateSync, ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { IsMaxDaysRange } from '../is-max-days-range.validator';

/**
 * Tests vía `validateSync` (no llamada directa al decorator) para que
 * un regression en `registerDecorator` falle loud, no silent.
 *
 * `RangeDto` aísla sólo el campo decorado con `@IsMaxDaysRange`. Otros
 * validators (IsString/Matches) viven en los DTOs consumidores y los
 * cubren los tests E2E de los resolvers.
 */

class RangeDto {
  startDate!: string;
  endDate!: string;
}

function applyMaxDays(cap: number, message?: string): void {
  IsMaxDaysRange(cap, message ? { message } : undefined)(
    RangeDto.prototype,
    'endDate',
  );
}

function makeDto(startDate: unknown, endDate: unknown): RangeDto {
  return Object.assign(new RangeDto(), { startDate, endDate });
}

/** 2025 is not a leap year: 2025-01-01 → 2026-01-01 = exactly 365 days. */
const START_2025 = '2025-01-01';
const END_2025_PLUS_365 = '2026-01-01'; // boundary inclusive
const END_2025_PLUS_366 = '2026-01-02'; // cap+1

describe('IsMaxDaysRange custom validator', () => {
  describe('boundary days (cap=365)', () => {
    it('passes when endDate equals startDate (0-day diff)', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto('2025-04-20', '2025-04-20'));
      expect(errs).toHaveLength(0);
    });

    it('passes when endDate is 1 day after startDate', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto('2025-04-20', '2025-04-21'));
      expect(errs).toHaveLength(0);
    });

    it('passes when endDate is exactly cap days after startDate (boundary inclusive)', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto(START_2025, END_2025_PLUS_365));
      expect(errs).toHaveLength(0);
    });

    it('fails when endDate is cap+1 days after startDate', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto(START_2025, END_2025_PLUS_366));
      expect(errs).toHaveLength(1);
      expect(errs[0].property).toBe('endDate');
    });
  });

  describe('invalid inputs', () => {
    it('fails when endDate is before startDate (inverted range)', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto('2025-04-20', '2025-04-19'));
      expect(errs).toHaveLength(1);
      expect(errs[0].property).toBe('endDate');
    });

    it('fails when startDate is missing from the source object', () => {
      applyMaxDays(365);
      const dto = new RangeDto();
      dto.endDate = '2025-04-20';
      const errs = validateSync(dto);
      expect(errs).toHaveLength(1);
    });

    it('fails when endDate is an empty string', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto('2025-04-20', ''));
      expect(errs).toHaveLength(1);
    });

    it('fails when startDate is an invalid date string', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto('not-a-date', '2025-04-20'));
      expect(errs).toHaveLength(1);
    });

    it('fails when endDate is a non-string value (number)', () => {
      // Cast because the DTO type intentionally lies to reproduce a
      // corrupted payload (frontend sending 12345 as a date).
      applyMaxDays(365);
      const errs = validateSync(makeDto('2025-04-20', 12345));
      expect(errs).toHaveLength(1);
    });

    it('fails when startDate is undefined', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto(undefined, '2025-04-20'));
      expect(errs).toHaveLength(1);
    });
  });

  describe('error messages', () => {
    it('falls back to defaultMessage() when no override is provided', () => {
      applyMaxDays(365);
      const errs = validateSync(makeDto(START_2025, END_2025_PLUS_366));
      const e = errs[0] as ValidationError;
      expect(e.constraints).toHaveProperty('isMaxDaysRange');
      expect(e.constraints?.isMaxDaysRange).toBe(
        'endDate must be no more than 365 days after startDate',
      );
    });

    it('respects validationOptions.message override when provided', () => {
      applyMaxDays(365, 'custom: too many days');
      const errs = validateSync(makeDto(START_2025, END_2025_PLUS_366));
      expect(errs[0].constraints?.isMaxDaysRange).toBe('custom: too many days');
    });
  });

  describe('cap parameter variants', () => {
    it('rejects when cap is 0 and any positive diff exists', () => {
      applyMaxDays(0);
      const errs = validateSync(makeDto('2025-01-01', '2025-01-02'));
      expect(errs).toHaveLength(1);
    });

    it('accepts when cap is 0 and endDate equals startDate', () => {
      applyMaxDays(0);
      const errs = validateSync(makeDto('2025-01-01', '2025-01-01'));
      expect(errs).toHaveLength(0);
    });

    it('reflects a custom cap in the default message', () => {
      applyMaxDays(7);
      const errs = validateSync(makeDto('2025-01-01', '2025-01-09'));
      expect(errs[0].constraints?.isMaxDaysRange).toBe(
        'endDate must be no more than 7 days after startDate',
      );
    });
  });
});
