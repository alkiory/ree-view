import { Field, Float, ObjectType } from '@nestjs/graphql';
import { LiveDemandRegionSlug } from './live-demand.input';

/**
 * Punto de la curva horaria de demanda del día en curso.
 * `h` es la etiqueta humana (`"00h"`, `"14h"`); `real` es la demanda
 * observada en MW; `prevista` es la publicada por REE como forecast.
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
 * Snapshot agregado de demanda + generación del momento presente (o
 * histórica si vino de `getHistoricalHourlySnapshot`). `timestamp`
 * representa el instante en que el backend lo generó.
 *
 * `region` se expone como enum (no `String` libre) para que el
 * frontend reciba un valor tipado y evitar typos en el flow
 * `pill onClick → useState → onRefetch`.
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

  /** Region slug (enum value). `null` = Nacional implícito. */
  @Field(() => LiveDemandRegionSlug, { nullable: true })
  region?: LiveDemandRegionSlug;
}
