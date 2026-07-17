import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LiveDemand } from '../schemas/live-demand.schema';
import { ReeClientService } from './ree-client.service';
import { LiveDemandRegionSlug } from '../dto/live-demand.input';

@Injectable()
export class LiveDemandService {
  private readonly logger = new Logger(LiveDemandService.name);

  constructor(
    @InjectModel(LiveDemand.name)
    private readonly liveModel: Model<LiveDemand>,
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
   *     `geo_limit`, buscar/cachear bajo literal 'Nacional' (display
   *     name) para mantener consistencia con la collection.
   *   - 'peninsular' / 'baleares' / 'canarias' / 'ceuta' / 'melilla' →
   *     REE con `?geo_limit=<slug>`, cache bajo el mismo string.
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

      // Resilience (CURRENT §3.27): Promise.allSettled degrada a defaults
      // si una de las 3 sub-rutas falla. Partial > nada.
      const [currentRes, curveRes, mixRes] = await Promise.allSettled([
        this.reeClient.fetchCurrentDemand(geoLimit ?? undefined),
        this.reeClient.fetchDailyDemandCurve(geoLimit ?? undefined),
        this.reeClient.fetchGenerationMix(geoLimit ?? undefined),
      ]);

      const currentMW =
        currentRes.status === 'fulfilled' ? currentRes.value : 0;
      if (currentRes.status === 'rejected') {
        this.logger.warn(
          `↻ Live snapshot partial — current-demand failed: ${
            currentRes.reason?.message ?? String(currentRes.reason)
          }`,
        );
      }

      const curve = curveRes.status === 'fulfilled' ? curveRes.value : [];
      if (curveRes.status === 'rejected') {
        this.logger.warn(
          `↻ Live snapshot partial — daily-demand-curve failed: ${
            curveRes.reason?.message ?? String(curveRes.reason)
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
   * Phase 2 §3.31 — historical hourly archive fallback.
   *
   * El frontend llama este resolver cuando el live snapshot está
   * degraded (zero-sentinels per §3.27 `Promise.allSettled`) y quiere
   * mostrar la curva horarios del día anterior en su lugar.
   *
   * `date: string` ISO 8601 (`YYYY-MM-DD`). `region?: enum` opcional.
   *
   * POR QUÉ NO se cachea con el mismo patrón que live:
   *   - Historical hourly data de REE no cambia retroactivamente (a
   *     diferencia de live tick). Cacheo agresivo (24h) sería una
   *     victoria barata — pero no prioritario en este turn: añadir
   *     cache complica schema (would need region+date compound key).
   *   - Live mockup consume 1 fetch / 60s; esto consume 1 fetch / poll
   *     sólo cuando live está degraded (rare path).
   * Future: si el degraded path se vuelve hot, añadir cache con
   * TTL=24h keyed por `(region, date)` en una collection separada
   * `LiveDemandHistorical`.
   *
   * Shape devuelto: MISMO que live (`LiveDemandSnapshot`), salvo
   * `currentDemandMW = curve[último].real` (mejor estimación del
   * "current" para una hora marcada), `maxForecastMW = curve.reduce
   * max(prevista)`, `minTodayMW = curve.reduce min(real > 0)`.
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
      const curve = await this.reeClient.fetchHistoricalHourly(
        parsed,
        geoLimit ?? undefined,
      );

      const currentMW =
        curve.length > 0 ? (curve[curve.length - 1]?.real ?? 0) : 0;
      const renewablePercentageValue = 0; // No expuesto por histórico
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
      };

      this.logger.log(
        `↻ Historical hourly fetched (date=${date}, region=${cacheKey}, points=${curve.length})`,
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
   * Normaliza el input enum (o undefined) al `cacheKey` literal que
   * se almacena bajo `LiveDemand.region` en Mongo. Display name —
   * IMPORTANTE: el schema usa el string kebab-case convertido al
   * slug español ('Nacional' con N mayúscula) para mantener
   * legibilidad con REGIONS del frontend.
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
    if (!region) return 'Nacional';
    const r = String(region);
    return r.charAt(0).toUpperCase() + r.slice(1);
  }

  /**
   * Convierte el cacheKey display ('Nacional' / 'Peninsular') al slug
   * kebab-case que REE acepta en `?geo_limit=`. Nacional → null (omit);
   * el resto baja a kebab-case.
   */
  private regionToGeoLimit(
    region?: LiveDemandRegionSlug | string | null,
  ): string | null {
    if (!region) return null;
    const lower = String(region).toLowerCase();
    return lower === 'nacional' ? null : lower;
  }

  /**
   * Phase 2 §3.31 schema migration note: pre-§3.31 docs en MongoDB no
   * tienen `region` field (region: undefined). El lookup
   * `findOne({region: 'Nacional'})` no los matchea. Migración
   * estrategia: TTL natural los limpia en ≤60s post-deploy (no
   * requiere una startup migration hook). Si en el futuro queremos
   * zero-downtime backfill, añadir `updateMany({region: {$exists:
   * false}}, {$set: {region: 'Nacional'}})` en `OnModuleInit`.
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
