import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Validator que comprueba que la diferencia entre `startDate` y la
 * propiedad decorada (por defecto `endDate`) está dentro de un máximo
 * de días. Los DTOs consumidores importan el cap desde su
 * `dto.constants.ts` para evitar duplicación cross-DTO.
 *
 * El cálculo de diff asume strings ISO `YYYY-MM-DD`, parseadas como
 * UTC midnight por `new Date(str)` — diffs enteros de días exactos
 * cross-TZ.
 */
export function IsMaxDaysRange(
  maxDays: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMaxDaysRange',
      target: object.constructor,
      propertyName,
      constraints: [maxDays],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const constraint = args.constraints[0] as number;
          const sourceObj = args.object as Record<string, unknown>;
          const startRaw = sourceObj.startDate;

          if (typeof value !== 'string' || typeof startRaw !== 'string') {
            return false;
          }
          if (!value || !startRaw) return false;

          const start = new Date(startRaw);
          const end = new Date(value);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return false;
          }
          if (end < start) return false;

          const diffDays =
            (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
          return diffDays <= constraint;
        },
        defaultMessage(args: ValidationArguments): string {
          const constraint = args.constraints[0] as number;
          return `${args.property} must be no more than ${constraint} days after startDate`;
        },
      },
    });
  };
}
