import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * §3.38 — Reintroducción del cache histórico que estaba documentado
 * en §3.35 pero nunca commiteado (phantom file).
 *
 * POR QUÉ schema SEPARADO (no añadir `LiveDemandHistorical` dentro
 *   de `live-demand.schema.ts`):
 *   - Live (TTL=60s) e Histórico (TTL=24h) tienen políticas de
 *     retención muy distintas; mezclarlas en una collection fuerza
 *     a llevar índices redundantes y crea drift semántico entre
 *     "snapshot fresco" y "snapshot histórico".
 *   - TTL de Mongo requiere un índice dedicado por colección; tener
 *     dos TTLs distintos en el mismo index no es posible sin
 *     workaround.
 *   - Separar permite reusar la collection en futuros tests sin
 *     tocar la operativa live.
 *
 * POR QUÉ composite unique (region + date):
 *   - 6 regions × ~365 días/año = ~2190 docs máximo activos en cualquier
 *     momento. Cada (region, date) es un snapshot único inmutable
 *     (REE no cambia histórico retroactivamente).
 *   - Composite unique permite `findOneAndUpdate(upsert)` atómico que
 *     protege contra race conditions concurrentes: si dos requests
 *     caen al mismo (region, date) sin cache hit, ambos hacen fetch
 *     a REE pero solo uno "gana" la escritura (last-write-wins).
 *
 * POR QUÉ date como STRING 'YYYY-MM-DD' (no Date object):
 *   - Lookup directo sin ambigüedad TZ: el input GraphQL es string,
 *     el service layer lo pasa a Mongo como string. Sin conversión
 *     intermedia que pueda driftar.
 *   - ISO 8601 con `@IsISO8601 strict` (frontend) lo garantiza ya.
 *   - String YYYY-MM-DD es natural composite-key (no requiere
 *     conversion padding/alignment).
 *
 * POR QUÉ timestamps: true (no declarar cachedAt explícito):
 *   - `createdAt` autogenerado sirve para TTL + auditoría. Migración
 *     futura a schema v2 (e.g. añadir `lastAccessedAt`) hereda este
 *     campo automáticamente.
 */
@Schema({ timestamps: true })
export class LiveDemandHistorical extends Document {
  /**
   * §3.38 — Region cache key. §3.41 update: almacenado en **enum value**
   * ('NACIONAL', 'PENINSULAR', etc.) — no kebab-Display. Razón: idéntica
   * a `LiveDemand.region` (consistency cross-collection) Y consistente
   * con `regionCacheKey` (live-demand.service.ts §3.41), que ahora
   * retorna enum value para que GraphQL enum serialization funcione
   * end-to-end.
   *
   * Si el service layer recibiera una llamada con `region === undefined`
   * y `findOne` no encontrase un doc, `regionCacheKey` (con default
   * 'NACIONAL') se usa como upsert key — el default del schema debe
   * coincidir para evitar upserts huérfanos con `region: 'NACIONAL'`
   * pero schema Mongoose `default: 'Nacional'` que dispararía validation
   * mismatch inadvertencia.
   *
   * El service layer garantiza la normalización via `regionCacheKey`.
   */
  @Prop({ type: String, required: true, default: 'NACIONAL' })
  region: string;

  /**
   * §3.38 — Day identifier in ISO 8601 'YYYY-MM-DD' format.
   *
   * NO es un Date object — es string literal para composite key
   * determinístico cross-TZ (cf. POR QUÉ en docstring arriba).
   */
  @Prop({ type: String, required: true })
  date: string;

  /**
   * La fecha histórica parseada (timestamp de la consulta original).
   * NO es now() — es `parsed` que el resolver recibe del input
   * del usuario (e.g. '2026-07-14').
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
   * Histórico NO expone mix separado desde REE (`generacion/estructura-
   * generacion` solo publica hoy, no histórico). Por convención el
   * service layer deja siempre 0 aquí. Declarado con default 0 para
   * que inserts automáticos (upsert sin `$set: renewablePercentageValue`)
   * no fallen validación `required: true`.
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

/**
 * §3.38 — Composite unique index. Protege contra:
 *   1. Cache miss concurrente con upsert atómico (last-write-wins).
 *   2. Migraciones que accidentalmente escriban 2 docs mismo
 *      (region, date).
 *
 * Custom name `historical_region_date_unique` para que aparezca
 * identificable en `db.collection.getIndexes()` (Mongo Compass).
 */
LiveDemandHistoricalSchema.index(
  { region: 1, date: 1 },
  { name: 'historical_region_date_unique', unique: true },
);

/**
 * §3.38 — TTL 24h (`expireAfterSeconds` sobre `createdAt` autogenerado).
 *
 * POR QUÉ 24h:
 *   - REE no cambia histórico retroactivamente. Una vez publicado el
 *     día, la curva es estable para siempre. TTL de 24h amortigua
 *     ráfagas de pollers del frontend en el único escenario donde
 *     cambian los datos: durante la primera hora post-publicación
 *     (refinamientos tardíos).
 *   - Más largo que 24h sería una mentira ambiental; REE técnicamente
 *     puede republicar datos consolidados varias horas después. Más
 *     corto que 24h golpea el upstream REE innecesariamente.
 *
 * POR QUÉ allowlist (`Number.isFinite && > 0`) y NO `|| 86400`:
 *   - §3.21 lo prohíbe. `Number('-1') || 86400` evalúa a -1 (truthy),
 *     desactivando el TTL silenciosamente. Allowlist es safe-parse.
 *   - Si alguien setea `HISTORICAL_CACHE_TTL_SECONDS=foo`, parseInt
 *     devuelve NaN — captured por `!Number.isFinite()`, fallback
 *     explícito al default.
 *   - Si alguien setea `-1` para "debug: desactivar TTL", no
 *     se aplica: el allowlist filtra.
 */
const _rawHistoricalTtl = Number(process.env.HISTORICAL_CACHE_TTL_SECONDS);
const HISTORICAL_CACHE_TTL_SECONDS: number =
  Number.isFinite(_rawHistoricalTtl) && _rawHistoricalTtl > 0
    ? _rawHistoricalTtl
    : 86400;

LiveDemandHistoricalSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: HISTORICAL_CACHE_TTL_SECONDS,
    name: 'historical_ttl_24h',
  },
);
