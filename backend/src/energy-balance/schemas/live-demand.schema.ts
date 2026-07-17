import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class LiveDemand extends Document {
  @Prop({ type: Date, required: true })
  timestamp: Date;

  @Prop({ type: Number, required: true })
  currentDemandMW: number;

  @Prop({ type: Number, required: true })
  maxForecastMW: number;

  @Prop({ type: Number, required: true })
  minTodayMW: number;

  @Prop({ type: Number, required: true })
  renewablePercentageValue: number;

  @Prop({
    type: [{ h: String, real: Number, prevista: Number }],
    default: [],
  })
  curve: { h: string; real: number; prevista: number }[];

  /**
   * Cache key por región eléctrica (Nacional, Peninsular, etc.).
   * Cada `(region)` tiene su propio slot; el TTL compartido (60s) hace
   * que un máximo de 6 documentos estén activos en cualquier momento.
   * El default es el enum value `NACIONAL`, alineado con `regionCacheKey`
   * del service layer para que el lookup y el upsert default coincidan.
   */
  @Prop({ type: String, required: true, default: 'NACIONAL' })
  region: string;
}

export const LiveDemandSchema = SchemaFactory.createForClass(LiveDemand);

LiveDemandSchema.index({ region: 1, createdAt: 1 }, { name: 'region_ttl' });

const CACHE_TTL_SECONDS = Number(process.env.LIVE_CACHE_TTL_SECONDS) || 60;
LiveDemandSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CACHE_TTL_SECONDS, name: 'live_demand_ttl_60s' },
);
