import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LiveDemand } from '../schemas/live-demand.schema';
import { LiveDemandHistorical } from '../schemas/live-demand-historical.schema';
import { ReeClientService } from './ree-client.service';
import { LiveDemandRegionSlug } from '../dto/live-demand.input';
import { buildDemandCurve } from '../util/aggregate-hourly';

@Injectable()
export class LiveDemandService {
  private readonly logger = new Logger(LiveDemandService.name);

  constructor(
    @InjectModel(LiveDemand.name)
    private readonly liveModel: Model<LiveDemand>,
    // §3.38 — colección de cache histórico. Composite unique key
    // (region, date), TTL 24h. Distinto del `liveModel` (TTL 60s) por
    // política de retención + semántica (inmutable vs sliding-window).
    @InjectModel(LiveDemandHistorical.name)
    private readonly historicalModel: Model<LiveDemandHistorical>,
    private readonly reeClient: ReeClientService,
  ) {}

  /**
   * Política cache-aside v2 (Phase 2 §3.31):
   *   1. Mongo TTL=60s garantiza que el documento más reciente siempre
   *      tiene <60s de antigüedad.
   *   2. Cache key incluye `region` — 6 documents máximo activos en
   *      cualquier momento (uno por region en cache hit). Per-region
   *      freshness está aislado: cambiar de Península a Canarias no
   *      invalida el cache de Nacional, etc.
   *   3. Si existe → devolver directo sin hit a REE.
   *   4. Si no existe → fetch paralelo de los 3 endpoints (con prefijo
   *      `?geo_limit=` cuando region != Nacional), merge, upsert keyed
   *      por region y devolver.
   *
   * `region?: LiveDemandRegionSlug`:
   *   - undefined / null / 'Nacional' (enum value 'nacional') → omit
   *     `geo_limit`, buscar/cachear bajo literal 'NACIONAL' (enum
   *     value) — necesario para que GraphQL enum serialization
   *     funcione end-to-end (cf. §3.41 fix).
   *   - 'peninsular' / 'baleares' / 'canarias' / 'ceuta' / 'melilla' →
   *     REE con `?geo_limit=<slug>`, cache bajo 'PENINSULAR' | … (enum
   *     value).
   *
   * Por qué 3 fetches paralelos en lugar de 1 consolidado: REE no
   * expone un endpoint único que devuelva {current, curve, mix} en
   * un call. Hacerlos en `Promise.allSettled` minimiza la latencia
   * percibida por el frontend.
   *
   * Por qué `findOne({region})` en lugar de `findOneAndUpdate`:
   *   - `findOne` + branch es más legible para tests y debugging.
   *   - Si el snapshot se stalea por race (dos requests cayendo al
   *     mismo tiempo sin cache hit pero mismo region), ambos hacen
   *     fetch y el segundo `findOneAndUpdate({region}, ...)` gana.
   *     Idempotente gracias al upsert key.
   */
  async getSnapshot(region?: LiveDemandRegionSlug): Promise<{
    currentDemandMW: number;
    maxForecastMW: number;
    minTodayMW: number;
    renewablePercentageValue: number;
    timestamp: Date;
    demandCurve: { h: string; real: number; prevista: number }[];
    region?: LiveDemandRegionSlug;
  }> {
    const cacheKey = this.regionCacheKey(region);
    const geoLimit = this.regionToGeoLimit(region);

    try {
      const cached = await this.liveModel
        .findOne({ region: cacheKey })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      if (cached) {
        // `.lean()` strip-sea los timestamp fields (createdAt/updatedAt)
        // del type `LiveDemand` aún cuando el schema tiene
        // `timestamps: true`. Para evitar el `as any` post-access que
        // rompía con TS2339, casteamos el doc entero antes del field
        // access — el runtime real adjunta `createdAt` por el
        // `@Schema({timestamps:true})`. El fallback `Infinity` cubre
        // el caso degenerado donde el doc existe pero sin createdAt.
        const createdAt = (cached as { createdAt?: Date }).createdAt;
        const ageMs = createdAt
          ? Date.now() - new Date(createdAt).getTime()
          : Number.POSITIVE_INFINITY;
        this.logger.log(
          `↻ Live cache hit (region=${cacheKey}, age=${Math.round(ageMs / 1000)}s)`,
        );
        return this.shape(cached);
      }

      this.logger.log(
        `↻ Live cache miss → fetching REE (region=${cacheKey}, geo_limit=${geoLimit ?? 'omitted'})`,
      );

      // §3.37 — refactor simplificado. La §3.32 hacía 3 fetches en
      // paralelo (current-demand + daily-curve + generation-mix) que
      // era redundante con el payload consolidado de
      // `demanda/demanda-tiempo-real` (4 series × 288 ticks). Ahora
      // 2 fetches: el canonical nuevo + generation mix (endpoint
      // separado para mix renewable).
      //
      // Resilience (CURRENT §3.27): Promise.allSettled degrada a defaults
      // si una de las 2 sub-rutas falla. Partial > nada.
      const [demandaRes, mixRes] = await Promise.allSettled([
        this.reeClient.fetchDemandaTiempoReal(geoLimit ?? undefined),
        this.reeClient.fetchGenerationMix(geoLimit ?? undefined),
      ]);

      // Default seguros (cf. §3.27 allSettled semantics).
      let currentMW = 0;
      let curve: { h: string; real: number; prevista: number }[] = [];

      if (demandaRes.status === 'fulfilled') {
        const items = demandaRes.value;
        // currentMW = último valor de la serie 'Real' (último tick del
        // momento presente o del día cerrado si la poll cae en fin de
        // jornada REE).
        const realItem = items.find((it) => it.type === 'Real');
        const lastReal =
          realItem && realItem.values.length > 0
            ? realItem.values[realItem.values.length - 1]
            : undefined;
        currentMW = lastReal?.value ?? 0;

        try {
          curve = buildDemandCurve(items);
        } catch (buildErr) {
          // Falla la curva cuando falta Real+Prevista o vienen con
          // count !=288. Degradamos a [] y dejamos el `mix` con su valor
          // — el frontend detecta `curve.length < 2` y muestra el KPI
          // estático «Última demanda diaria conocida» (per Opción C §3.34).
          this.logger.warn(
            `↻ Live snapshot partial — curve build failed: ${
              buildErr?.message ?? String(buildErr)
            }`,
          );
          curve = [];
        }
      } else {
        this.logger.warn(
          `↻ Live snapshot partial — demanda-tiempo-real failed: ${
            demandaRes.reason?.message ?? String(demandaRes.reason)
          }`,
        );
      }

      const mix =
        mixRes.status === 'fulfilled'
          ? mixRes.value
          : { renewablePercentageValue: 0 };
      if (mixRes.status === 'rejected') {
        this.logger.warn(
          `↻ Live snapshot partial — generation-mix failed: ${
            mixRes.reason?.message ?? String(mixRes.reason)
          }`,
        );
      }

      const maxForecastMW = curve.reduce(
        (acc, p) => Math.max(acc, p.prevista),
        0,
      );
      const minTodayMW = curve.reduce(
        (acc, p) => (p.real > 0 ? Math.min(acc, p.real) : acc),
        currentMW,
      );

      const snapshot = {
        timestamp: new Date(),
        currentDemandMW: currentMW,
        maxForecastMW,
        minTodayMW,
        renewablePercentageValue: mix.renewablePercentageValue,
        curve,
        region: cacheKey,
      };

      // Upsert keyado por region — concurrent races (dos requests
      // cayendo cuando el doc expiró, mismo region) son idempotentes
      // porque el `findOneAndUpdate({region}, {$set: ...}, {upsert})`
      // gana para el último en escribir.
      await this.liveModel.findOneAndUpdate(
        { region: cacheKey },
        { $set: snapshot },
        { upsert: true, new: true },
      );

      return this.shape(snapshot);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to compute live demand snapshot: ${
          error?.message ?? 'unknown error'
        }`,
        { cause: error },
      );
    }
  }

  /**
   * Phase 2 §3.31 + §3.38 — historical hourly archive fallback.
   *
   * El frontend llama este resolver cuando el live snapshot está
   * degraded (zero-sentinels per §3.27 `Promise.allSettled`) y quiere
   * mostrar la curva horarios del día anterior en su lugar.
   *
   * `date: string` ISO 8601 (`YYYY-MM-DD`). `region?: enum` opcional.
   *
   * §3.38 — Cache-aside v1 contra `LiveDemandHistorical`:
   *
   *   1. `findOne({region: cacheKey, date})` — composite unique lookup.
   *   2. Si hit → devolver shape desde cache (0 fetch a REE).
   *   3. Si miss → fetch a `demanda-tiempo-real` con rango explícito,
   *      computar curva + KPIs, atomic upsert vía
   *      `findOneAndUpdate({region, date}, {$set}, {upsert, new})`.
   *   4. Errores NO se cachean (negative cache desactivada): REE
   *      upstream falló → re-throw tal cual → caller decide.
   *
   * Race conditions: 2 requests concurrentes mismo (region, date)
   * pasan el cache miss en simultáneo, ambos hacen fetch a REE,
   * ambos intentan upsert. El composite unique key + MongoDB's
   * single-doc atomicity garantiza last-write-wins (idempotente).
   *
   * POR QUÉ TTL 24h (no más largo, no más corto):
   *   - REE no cambia histórico retroactivamente — 24h es el sweet
   *     spot entre amortiguar pollers y dejar margen para refinamientos
   *     tardíos del upstream REE (consolidación post-publicación).
   *   - Env override `HISTORICAL_CACHE_TTL_SECONDS` (allowlist per
   *     §3.21) en el schema.
   *
   * Shape devuelto: MISMO que live (`LiveDemandSnapshot`), salvo
   * `currentDemandMW = curve[último].real`, `renewablePercentageValue
   * = 0` (histórico no expone mix separado).
   */
  async getHistoricalHourlySnapshot(
    date: string,
    region?: LiveDemandRegionSlug,
  ): Promise<{
    currentDemandMW: number;
    maxForecastMW: number;
    minTodayMW: number;
    renewablePercentageValue: number;
    timestamp: Date;
    demandCurve: { h: string; real: number; prevista: number }[];
    region?: LiveDemandRegionSlug;
  }> {
    // Validamos el formato defensivo antes de mandar a REE. La capa
    // DTO (`@IsISO8601 strict`) ya valida, pero no queremos crashear
    // con TypeError en runtime si fuera null.
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new InternalServerErrorException(
        `Invalid historical date: ${date} (must be YYYY-MM-DD)`,
      );
    }
    const geoLimit = this.regionToGeoLimit(region);
    const cacheKey = this.regionCacheKey(region);

    try {
      // §3.38 — cache lookup (composite unique key).
      const cached = await this.historicalModel
        .findOne({ region: cacheKey, date })
        .lean()
        .exec();

      if (cached) {
        const createdAt = (cached as { createdAt?: Date }).createdAt;
        const ageMs = createdAt
          ? Date.now() - new Date(createdAt).getTime()
          : Number.POSITIVE_INFINITY;
        this.logger.log(
          `↻ Historical cache hit (region=${cacheKey}, date=${date}, age=${Math.round(ageMs / 1000)}s)`,
        );
        return this.shape(cached);
      }

      this.logger.log(
        `↻ Historical cache miss → fetching REE (region=${cacheKey}, date=${date}, geo_limit=${geoLimit ?? 'omitted'})`,
      );

      // §3.37 — historical path: una sola llamada al endpoint
      // `demanda-tiempo-real` con rango explícito. REE expone
      // histórico para cualquier fecha pasada con la misma
      // granularidad 5-min.
      const items = await this.reeClient.fetchDemandaTiempoReal(
        geoLimit ?? undefined,
        parsed,
      );
      const curve = buildDemandCurve(items);

      const currentMW =
        curve.length > 0 ? (curve[curve.length - 1]?.real ?? 0) : 0;
      const renewablePercentageValue = 0; // Histórico no expone mix separado
      const maxForecastMW = curve.reduce(
        (acc, p) => Math.max(acc, p.prevista),
        0,
      );
      const minTodayMW = curve.reduce(
        (acc, p) => (p.real > 0 ? Math.min(acc, p.real) : acc),
        currentMW,
      );

      const snapshot = {
        timestamp: parsed, // ISO de la fecha histórica pedida (no now)
        currentDemandMW: currentMW,
        maxForecastMW,
        minTodayMW,
        renewablePercentageValue,
        curve,
        region: cacheKey,
        // §3.38 FIX — incluir `date` en el $set para que la collection
        // tenga el campo required del schema. Mongo (con composite
        // unique) PUEDE inferirlo del filter key, pero la doc guardada
        // no necesariamente lo contiene — confiar en eso es implícito.
        // Setearlo explicit garantiza integridad del cache lookup.
        date,
      };

      // Atomic upsert — race-safe via composite unique key
      // {region, date}. Concurrent fetches para el mismo (region, date)
      // producen last-write-wins (idempotente — los datos de REE son
      // deterministas por día cerrado).
      await this.historicalModel.findOneAndUpdate(
        { region: cacheKey, date },
        { $set: snapshot },
        { upsert: true, new: true },
      );

      this.logger.log(
        `↻ Historical hourly cached (date=${date}, region=${cacheKey}, points=${curve.length})`,
      );

      return this.shape(snapshot);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to compute historical snapshot (date=${date}, region=${cacheKey}): ${
          error?.message ?? 'unknown error'
        }`,
        { cause: error },
      );
    }
  }

  /**
   * §3.41 — Normaliza el input enum (o undefined) al `cacheKey` literal
   * que se almacena bajo `LiveDemand.region` en Mongo Y se devuelve en
   * `snapshot.region` al resolver. El contrato es el **enum value** de
   * `LiveDemandRegionSlug` ('NACIONAL' / 'PENINSULAR' / 'BALEARES' /
   * 'CANARIAS' / 'CEUTA' / 'MELILLA'), NO el Display name kebab-case.
   *
   * Por qué enum value (no display name): el schema GraphQL declara
   * `region: LiveDemandRegionSlug` en `LiveDemandSnapshot.region`. La
   * serialización del response invoca `GraphQLEnumType.serialize()`,
   * que rechaza cualquier string que no sea uno de los valores literales
   * del enum. Si `cacheKey` devuelve 'Nacional' (display), la
   * serialización lanza `"Enum 'LiveDemandRegionSlug' cannot represent
   * value: 'Nacional'"` y el response entero falla.
   *
   * Acepta y normaliza CUALQUIER formato de entrada al enum value:
   *   undefined / 'nacional' / 'NACIONAL' / 'Nacional' / 'peninsular' / 'PENINSULAR' / 'Peninsular' / …
   *   → siempre retorna enum value ('NACIONAL' / 'PENINSULAR' / 'BALEARES' / 'CANARIAS' / 'CEUTA' / 'MELILLA').
   *
   * §3.41 WAS §3.38: la versión kebab-Display ('Nacional') vivía aquí
   * y forzaba GraphQL enum serialization failure. Por qué nadie lo
   * cazó antes: los specs mockean el service layer pero NO prueban la
   * serialización GraphQL — el bug sólo aparecía en el bootstrap real
   * del schema + un response con datos (no request validation). Future
   * agent que toque `regionCacheKey` debe leer §3.41 ANTES de cambiar
   * la convención (superficie de breaking change silent).
   *
   * FIX (TS narrowing Phase 2 §3.31): usamos `String(region)` para
   * colapso de tipos en runtime. Sin esto, ramas con `typeof region
   * === 'string'` crean narrowing `region: never` detrás del primer
   * check (string-enum quirk de TypeScript: enum values son string-
   * type specialist, y `typeof === 'string'` los saca de la union;
   * cualquier branch residual resulta en `never`).
   */
  private regionCacheKey(
    region?: LiveDemandRegionSlug | string | null,
  ): string {
    if (!region) return 'NACIONAL';
    return String(region).toUpperCase();
  }

  /**
   * §3.41 — Convierte el input (enum value 'NACIONAL' / 'PENINSULAR'
   * o cualquier string suelto kebab/kebab-Display) al slug kebab-lowercase
   * que REE acepta en `?geo_limit=`. 'nacional' → null (omit); cualquier
   * otro como 'peninsular' | 'baleares' | 'canarias' | 'ceuta' | 'melilla'
   * baja a kebab-lowercase y se pasa forward.
   *
   * Por qué `.toLowerCase()` se aplica al input aquí: el input llega
   * post-§3.41 como enum value ('NACIONAL' | 'PENINSULAR') pero también
   * puede llegar kebab-lowercase ('nacional' | 'peninsular') si un caller
   * external decide pasarlo raw. Independientemente del casing de
   * entrada, la normalización converge al mismo slug kebab-lowercase
   * que REE acepta. Migraciones upstream que cambien el casing del
   * enum value no propagan — regionToGeoLimit absorbe el drift.
   */
  private regionToGeoLimit(
    region?: LiveDemandRegionSlug | string | null,
  ): string | null {
    if (!region) return null;
    const lower = String(region).toLowerCase();
    return lower === 'nacional' ? null : lower;
  }

  /**
   * §3.41 schema migration note — pre-§3.41 docs en MongoDB tienen
   * `region` en kebab-Display ('Nacional' | 'Peninsular' | …) desde
   * §3.31. Tras el fix de enum serialization (regionCacheKey retorna
   * enum value: 'NACIONAL' | 'PENINSULAR' | …), el lookup
   * `findOne({region: 'NACIONAL'})` no matchea esos docs preexistentes.
   *
   *   - Live (`LiveDemand`): TTL natural limpia en ≤60s post-deploy;
   *     backfill innecesario.
   *   - Historical (`LiveDemandHistorical`): TTL 24h — ventana
   *     tolerable de cache miss post-deploy (REE upstream sólo se
   *     consulta una vez cada 24h por `(region, date)`).
   *
   * Si en el futuro queremos zero-downtime backfill, añadir en
   * `OnModuleInit`:
   *   ```ts
   *   await this.liveModel.updateMany(
   *     { region: { $in: ['Nacional', 'Peninsular', …] } },
   *     [{ $set: { region: { $toUpper: '$region' } } }],
   *   );
   *   ```
   *
   * Esta nota está aquí (en lugar de método vacío anterior) para
   * satisfacer ESLint `no-unused-private-method`.
   */

  /** Aplana un documento Mongo (o un objeto ya shapeado) al contrato
   *  del resolver. `lean()` arriba devuelve `_id` extra; aquí lo
   *  descartamos. */
  private shape(doc: any): {
    currentDemandMW: number;
    maxForecastMW: number;
    minTodayMW: number;
    renewablePercentageValue: number;
    timestamp: Date;
    demandCurve: { h: string; real: number; prevista: number }[];
    region?: LiveDemandRegionSlug;
  } {
    return {
      currentDemandMW: Number(doc.currentDemandMW ?? 0),
      maxForecastMW: Number(doc.maxForecastMW ?? 0),
      minTodayMW: Number(doc.minTodayMW ?? 0),
      renewablePercentageValue: Number(doc.renewablePercentageValue ?? 0),
      timestamp:
        doc.timestamp instanceof Date ? doc.timestamp : new Date(doc.timestamp),
      demandCurve: Array.isArray(doc.curve) ? doc.curve : [],
      region: doc.region as LiveDemandRegionSlug | undefined,
    };
  }
}
