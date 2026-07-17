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
    @InjectModel(LiveDemandHistorical.name)
    private readonly historicalModel: Model<LiveDemandHistorical>,
    private readonly reeClient: ReeClientService,
  ) {}

  /**
   * Política cache-aside con key por región. Mongo TTL=60s garantiza
   * que el doc devuelto tenga <60s de antigüedad; si no existe, fetch
   * paralelo a REE (demanda + mix renewable), merge y upsert keyed
   * por region. `region` undefined/'nacional' se trata como Nacional.
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

      const [demandaRes, mixRes] = await Promise.allSettled([
        this.reeClient.fetchDemandaTiempoReal(geoLimit ?? undefined),
        this.reeClient.fetchGenerationMix(geoLimit ?? undefined),
      ]);

      let currentMW = 0;
      let curve: { h: string; real: number; prevista: number }[] = [];

      if (demandaRes.status === 'fulfilled') {
        const items = demandaRes.value;
        const realItem = items.find((it) => it.type === 'Real');
        const lastReal =
          realItem && realItem.values.length > 0
            ? realItem.values[realItem.values.length - 1]
            : undefined;
        currentMW = lastReal?.value ?? 0;

        try {
          curve = buildDemandCurve(items);
        } catch (buildErr) {
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
   * Snapshot histórico horario para una fecha (`YYYY-MM-DD`) y región
   * opcional. Cache-aside contra `LiveDemandHistorical` con composite
   * unique key `(region, date)` y TTL 24h (REE no cambia histórico
   * retroactivamente). Errores no se cachean (negative cache desactivada).
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
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new InternalServerErrorException(
        `Invalid historical date: ${date} (must be YYYY-MM-DD)`,
      );
    }
    const geoLimit = this.regionToGeoLimit(region);
    const cacheKey = this.regionCacheKey(region);

    try {
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

      const items = await this.reeClient.fetchDemandaTiempoReal(
        geoLimit ?? undefined,
        parsed,
      );
      const curve = buildDemandCurve(items);

      const currentMW =
        curve.length > 0 ? (curve[curve.length - 1]?.real ?? 0) : 0;
      const renewablePercentageValue = 0;
      const maxForecastMW = curve.reduce(
        (acc, p) => Math.max(acc, p.prevista),
        0,
      );
      const minTodayMW = curve.reduce(
        (acc, p) => (p.real > 0 ? Math.min(acc, p.real) : acc),
        currentMW,
      );

      const snapshot = {
        timestamp: parsed,
        currentDemandMW: currentMW,
        maxForecastMW,
        minTodayMW,
        renewablePercentageValue,
        curve,
        region: cacheKey,
        date,
      };

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
   * Normaliza el input (enum value o kebab/Display suelto) al cacheKey
   * literal almacenado bajo `LiveDemand.region` y devuelto en
   * `snapshot.region`. El contrato es el **enum value** de
   * `LiveDemandRegionSlug` (e.g. `NACIONAL`), no el Display kebab-case.
   * Sin esta normalización, `GraphQLEnumType.serialize()` rechaza la
   * respuesta y la query entera falla.
   *
   * `String(region)` colapsa el union TypeScript en runtime: con
   * `typeof region === 'string'` primero, TS estrecha el resto del
   * flow a `never`. Sin el cast, ramas residuales son inalcanzables
   * pero el compilador las marca como `never` y rompe el service.
   */
  private regionCacheKey(
    region?: LiveDemandRegionSlug | string | null,
  ): string {
    if (!region) return 'NACIONAL';
    return String(region).toUpperCase();
  }

  /**
   * Convierte el input al slug kebab-lowercase que REE acepta en
   * `?geo_limit=`. `nacional` → `null` (omit); cualquier otro slug se
   * pasa lowercase.
   */
  private regionToGeoLimit(
    region?: LiveDemandRegionSlug | string | null,
  ): string | null {
    if (!region) return null;
    const lower = String(region).toLowerCase();
    return lower === 'nacional' ? null : lower;
  }

  /**
   * Aplana un documento Mongo (o un objeto ya shapeado) al contrato
   * del resolver. `lean()` devuelve `_id` extra que aquí descartamos.
   */
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
