import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Cache histórica de snapshots horarios. Colección independiente de
 * `LiveDemand` para poder tener TTLs distintos (24h vs 60s) y evitar
 * índices redundantes. La clave compuesta `(region, date)` actúa como
 * unique index para upserts atómicos en escenarios concurrentes.
 */
@Schema({ timestamps: true })
export class LiveDemandHistorical extends Document {
  /** Region cache key en enum value (`NACIONAL`, `PENINSULAR`, …). */
  @Prop({ type: String, required: true, default: 'NACIONAL' })
  region: string;

  /** Identificador del día en formato `YYYY-MM-DD` (no Date). */
  @Prop({ type: String, required: true })
  date: string;

  /**
   * Timestamp parseado de la consulta original (`parsed` que el resolver
   * recibe del input), no `now()`.
   */
  @Prop({ type: Date, required: true })
  timestamp: Date;

  @Prop({ type: Number, required: true })
  currentDemandMW: number;

  @Prop({ type: Number, required: true })
  maxForecastMW: number;

  @Prop({ type: Number, required: true })
  minTodayMW: number;

  /**
   * REE no expone mix renewable/no-renewable en histórico. Por
   * convención el service layer deja siempre `0`.
   */
  @Prop({ type: Number, required: true, default: 0 })
  renewablePercentageValue: number;

  @Prop({
    type: [{ h: String, real: Number, prevista: Number }],
    default: [],
  })
  curve: { h: string; real: number; prevista: number }[];
}

export const LiveDemandHistoricalSchema =
  SchemaFactory.createForClass(LiveDemandHistorical);

LiveDemandHistoricalSchema.index(
  { region: 1, date: 1 },
  { name: 'historical_region_date_unique', unique: true },
);

LiveDemandHistoricalSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 86_400,
    name: 'historical_ttl_24h',
  },
);
