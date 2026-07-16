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
}

export const LiveDemandSchema = SchemaFactory.createForClass(LiveDemand);

// TTL de 60s sobre `createdAt` (autogenerado por `timestamps: true`).
// La política de cache-aside en `LiveDemandService` aprovecha este TTL:
// un documento insertado hace <60s se devuelve sin tocar REE; tras 60s
// MongoDB lo expira y la próxima query regenera el snapshot contra la
// API live.
//
// Por qué 60s y no 86400s como el cache histórico:
//   - El cache histórico cachea `EnergyBalance`/`Frontera` para rangos
//     pasados — la API REE no cambia retroactivamente, así que 24h es
//     correcto.
//   - La data live CAMBIA cada ~5min (REE publica tick). Un TTL de 24h
//     sería una mentira ambiental. 60s mantiene freshness mientras
//     amortigua ráfagas de pollers (frontend a 60s + throttler 30/min
//     puede coincidir ocasionalmente).
//
// Por qué custom name `live_demand_ttl_60s`: idéntica convención a
// `ree_view_ttl_createdAt` en los históricos; permite identificar el
// índice en MongoDB Compass / `db.collection.getIndexes()` y distinguirlo
// del histórico a primera vista durante debugging.
const CACHE_TTL_SECONDS = Number(process.env.LIVE_CACHE_TTL_SECONDS) || 60;
LiveDemandSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CACHE_TTL_SECONDS, name: 'live_demand_ttl_60s' },
);
