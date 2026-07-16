import { Field, Float, ObjectType } from '@nestjs/graphql';

/**
 * Punto de la curva horaria de demanda del día en curso.
 * `h` es la etiqueta humana («00h», «14h», etc.) que se usa como dataKey
 * en el AreaChart del frontend. `real` es la demanda observada en
 * MW; `prevista` es la publicada por REE como forecast para esa hora.
 */
@ObjectType()
export class DemandCurvePoint {
  @Field(() => String)
  h: string;

  @Field(() => Float)
  real: number;

  @Field(() => Float)
  prevista: number;
}

/**
 * Snapshot agregado de demanda + generación del momento presente. El
 * campo `timestamp` representa el instante en el que el backend lo
 * generó (no el `publishedAt` de REE, que ya viene absorbido por el
 * cache).
 *
 * Los strings formateados (`currentDemandGW`, `renewablePercentage`,
 * `maxForecastGW`, `minTodayGW`, `co2Emissions`) son proyecciones
 * del frontend: en realidad sólo se computan en cliente. Mantenerlos
 * en backend es opcional (currentDemandGW es trivial). Decisión: no
 * duplicar formatting del lado backend; el frontend puede hacer
 * `Number → string` en un `useMemo`. Reducimos superficie de typos.
 *
 * `co2Emissions` queda como string nullable porque REE publica
 * intensidad de carbono como `gCO₂eq/kWh` pero esa API no está
 * todavía cableada (ver CURRENT.md §6 TODO #12). Mientras tanto el
 * campo se omite del response vía `nullable: true`.
 */
@ObjectType()
export class LiveDemandSnapshot {
  @Field(() => Float)
  currentDemandMW: number;

  @Field(() => Float)
  maxForecastMW: number;

  @Field(() => Float)
  minTodayMW: number;

  @Field(() => Float)
  renewablePercentageValue: number;

  @Field(() => Date)
  timestamp: Date;

  @Field(() => [DemandCurvePoint])
  demandCurve: DemandCurvePoint[];

  @Field(() => String, { nullable: true })
  co2Emissions?: string;
}
