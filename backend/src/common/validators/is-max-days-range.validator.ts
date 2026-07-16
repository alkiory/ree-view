import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Validador que comprueba que la diferencia entre `startDate` y la propiedad
 * decorada (por defecto `endDate`) esté dentro de un máximo de días.
 *
 * Los DTOs consumidores (p.ej. `EnergyBalanceInput`, `FronteraInput`) suelen
 * importar el cap desde su `dto.constants.ts` en vez de pasar un número
 * literal, para evitar duplicación cross-DTO y para honrar la env var
 * `MAX_DATE_RANGE_DAYS`. El validator en sí es stateless: cualquier número
 * positivo funciona como cap.
 *
 * El cálculo de diff asume strings ISO `YYYY-MM-DD`, parseadas por
 * `new Date(str)` como UTC midnight. Por eso los diffs enteros de días
 * son exactos independientemente de la zona horaria del runtime.
 *
 * @example
 *   class RangeDto {
 *     @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
 *     startDate: string;
 *
 *     @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
 *     @IsMaxDaysRange(365)        // en DTOs reales: MAX_DATE_RANGE_DAYS
 *     endDate: string;
 *   }
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
