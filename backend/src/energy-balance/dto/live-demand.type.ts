import { Field, Float, ObjectType } from '@nestjs/graphql';
import { LiveDemandRegionSlug } from './live-demand.input';

/**
 * Punto de la curva horaria de demanda del día en curso.
 * `h` es la etiqueta humana («00h», «14h», etc.) que se usa como dataKey
 * en el AreaChart del frontend. `real` es la demanda observada en
 * MW; `prevista` es la publicada por REE como forecast para esa hora.
 *
 * Phase 2 §3.31: ahora la curva queda acotada al `region` pedido. REE
 * devuelve la misma shape `value+datetime+geo_id` per region, así que
 * no necesitamos nuevos columns aquí — el binding a `region` vive en
 * `LiveDemandSnapshot` (1 query → 1 region → 1 curve).
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
 * Phase 2 §3.31 update:
 *   - `region` agregado: identifica CUÁL region fue consultada. El
 *     frontend lo recibe para tag-ear la cache key + UI label.
 *   - `isHistorical` agregado: el frontend distingue el snapshot en
 *     vivo del fallback histórico (no en el shape actual — pero la
 *     distinción se computa client-side based on snap timestamp vs
 *     threshold; ver `<HistoricalFallback />`).
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
 *
 * `region` se expone aquí también para el historical archive
 * (`getHistoricalHourlySnapshot`), donde el campo tiene el mismo rol.
 *
 * Por qué `region` es enum en el contrato GraphQL, NO `String`:
 *   El frontend recibe un `LiveDemandRegionSlug` real (typed enum),
 *   no un literal libre. Esto previene typos en la UI al mapeo del
 *   pill onClick → `useState → onRefetch`.
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

  /**
   * Region slug (enum value, kebab-case stringified). Nullable en
   * backward-compat: métodos que no reciben region sirven el snapshot
   * con `region: null` implícito (= 'nacional').
   */
  @Field(() => LiveDemandRegionSlug, { nullable: true })
  region?: LiveDemandRegionSlug;
}
