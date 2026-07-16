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
   * Phase 2 §3.31 — region-keyed cache.
   *
   * Phase 2 §3.27/§3.28 inicial guardaban UN solo doc (sobreescribiendo).
   * Ahora con region picker, cada `(region)` tiene su propio slot. TTL es
   * el mismo (60s) → max 6 docs activos en cualquier momento.
   *
   * Default 'Nacional' (slug absent) para backward-compat con docs
   * pre-§3.31 que se insertaron sin region. El composite index abajo
   * cubre queries cacheadas per-region + TTL scan.
   *
   * NOTA: si la collection ya tiene datos sin `region`, Mongo ODM aplica
   * default retroactivo sólo al insert/save — los docs existentes quedan
   * con field undefined. La service layer trata `region === null` como
   * 'Nacional' lo cual sigue funcionando porque el lookup
   * `findOne({region: 'Nacional'})` no matchea docs preexistentes con
   * `region: undefined`. La doc-cleanup (Mongoose @Schema sin
   * graceful migration per project convention — "no migration, brief
   * downtime OK") cae en schematic re-creation al deploy siguiente.
   */
  @Prop({ type: String, required: true, default: 'Nacional' })
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
