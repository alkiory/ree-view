import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LiveDemand } from '../schemas/live-demand.schema';
import { ReeClientService } from './ree-client.service';

@Injectable()
export class LiveDemandService {
  private readonly logger = new Logger(LiveDemandService.name);

  constructor(
    @InjectModel(LiveDemand.name)
    private readonly liveModel: Model<LiveDemand>,
    private readonly reeClient: ReeClientService,
  ) {}

  /**
   * Política cache-aside:
   *   1. Mongo TTL=60s garantiza que el documento más reciente siempre
   *      tiene <60s de antigüedad — si no existe, es que justamente
   *      expiró o es el primer hit.
   *   2. Si existe → devolver directo sin hit a REE.
   *   3. Si no existe → fetch paralelo de los 3 endpoints, merge,
   *      upsert (single document) y devolver.
   *
   * Por qué 3 fetches paralelos en lugar de 1 consolidado: REE no
   * expone un endpoint único que devuelva {current, curve, mix} en
   * un call. Hacerlos en `Promise.all` minimiza la latencia
   * percibida por el frontend (la sección live hace poll de 60s).
   *
   * Por qué `findOne` en lugar de `findOneAndUpdate`:
   *   - `findOne` + branch es más legible para tests y debugging
   *     (ver spec/mock pattern).
   *   - Si el snapshot se stalea por race (dos requests cayendo al
   *     mismo tiempo cuando el doc ya expiró), ambos hacen fetch y
   *     el segundo `findOneAndUpdate({upsert})` gana. Idempotente.
   */
  async getSnapshot(): Promise<{
    currentDemandMW: number;
    maxForecastMW: number;
    minTodayMW: number;
    renewablePercentageValue: number;
    timestamp: Date;
    demandCurve: { h: string; real: number; prevista: number }[];
  }> {
    try {
      const cached = await this.liveModel
        .findOne()
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
        this.logger.log(`↻ Live cache hit (age=${Math.round(ageMs / 1000)}s)`);
        return this.shape(cached);
      }

      this.logger.log('↻ Live cache miss → fetching REE (3 endpoints)');

      // Resilience (CURRENT §6 #17 — Real REE live indicator URLs):
      //   Las 3 sub-rutas (`current-demand` / `daily-demand-curve` /
      //   `generation-mix`) son GUESSED hoy — no son paths reales de
      //   `apidatos.ree.es`. Con `Promise.all`, una sola falla 404
      //   rompe el snapshot entero y la UI ve error GraphQL cada 60s.
      //   `Promise.allSettled` degrada a defaults + WARN logs en lugar
      //   de bloquear el snapshot. DATOS PARCIALES SON MEJOR QUE NADA.
      //
      //   Trade-off conocido: cuando las URLs reales aún no estén
      //   investigadas (TODO §6 #17), los 3 fetches fallarán cada
      //   60s. La UI verá ceros/curva vacía durante 60s antes del
      //   próximo retry. NO es un crash; es un snapshot degradado.
      //
      //   Cuando se investiguen los indicator IDs reales de REE ESIOS,
      //   este codepath ya estará estructurado para absorber fallos
      //   individuales de forma permanente (REE ESIOS tiene rate-limit
      //   propio y puntualmente puede 5xx un sub-route).
      const [currentRes, curveRes, mixRes] = await Promise.allSettled([
        this.reeClient.fetchCurrentDemand(),
        this.reeClient.fetchDailyDemandCurve(),
        this.reeClient.fetchGenerationMix(),
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
      };

      // Upsert el documento (sólo hay 1 lógico; reemplaza al anterior
      // inmediatamente y deja que el TTL se encargue del borrado físico
      // a los 60s). Mantiene el modelo bounded a 1 fila activa.
      await this.liveModel.findOneAndUpdate(
        {},
        { $set: snapshot },
        { upsert: true, new: true },
      );

      return this.shape(snapshot);
    } catch (error) {
      // Si el `findOne` previo estaba OK pero el segundo guardado
      // falla, REE ya fue golpeado — propagamos el error para que
      // Apollo (vía `extractErrorDetail`) muestre la causa real y el
      // cliente pueda reintentar al próximo poll.
      throw new InternalServerErrorException(
        `Failed to compute live demand snapshot: ${
          error?.message ?? 'unknown error'
        }`,
        { cause: error },
      );
    }
  }

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
  } {
    return {
      currentDemandMW: Number(doc.currentDemandMW ?? 0),
      maxForecastMW: Number(doc.maxForecastMW ?? 0),
      minTodayMW: Number(doc.minTodayMW ?? 0),
      renewablePercentageValue: Number(doc.renewablePercentageValue ?? 0),
      timestamp:
        doc.timestamp instanceof Date ? doc.timestamp : new Date(doc.timestamp),
      demandCurve: Array.isArray(doc.curve) ? doc.curve : [],
    };
  }
}
