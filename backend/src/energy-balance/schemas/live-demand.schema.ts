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
   * §3.31 — region-keyed cache. §3.27/§3.28 inicial guardaban UN solo
   * doc (sobreescribiendo). Ahora con region picker, cada `(region)`
   * tiene su propio slot. TTL es el mismo (60s) → max 6 docs activos
   * en cualquier momento.
   *
   * §3.41 — `default` ahora es el **enum value** 'NACIONAL' (no el
   * Display 'Nacional'). Razón: `regionCacheKey` retorna enum value
   * (ver `live-demand.service.ts:regionCacheKey` docstring §3.41), por
   * lo que `findOne({region: cacheKey})` busca bajo 'NACIONAL'. Para
   * que el upsert default también use 'NACIONAL' (consistencia entre
   * el cache lookup key y el upsert key en caso de Mongoose defaults
   * fire), el default del schema debe coincidir.
   *
   * El composite index abajo cubre queries cacheadas per-region + TTL
   * scan.
   *
   * NOTA migración: si la collection ya tiene docs pre-§3.31 con
   * `region: 'Nacional'` (kebab-Display), el lookup
   * `findOne({region: 'NACIONAL'})` no los matchea. La service layer
   * trata `region === undefined` como 'NACIONAL' (cache miss → re-fetch).
   * TTL natural (60s) limpia los docs viejos sin necesidad de backfill.
   */
  @Prop({ type: String, required: true, default: 'NACIONAL' })
  region: string;
}

export const LiveDemandSchema = SchemaFactory.createForClass(LiveDemand);

// Phase 2 §3.31: nuevo composite index `{ region, createdAt }` para
// (a) cache lookup por región eficiente, (b) TTL scan de docs expirados.
// MongoDB TTL index scan itera TODO el index — composite key reduce
// el scan surface por region (TTL de 60s por region → n=6 regions).
LiveDemandSchema.index({ region: 1, createdAt: 1 }, { name: 'region_ttl' });

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
