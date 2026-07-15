import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { EnergyBalance } from '../schemas/energy-balance.schema';
import { ReeClientService } from './ree-client.service';

@Injectable()
export class EnergyBalanceService {
  private readonly logger = new Logger(ReeClientService.name);
  constructor(
    @InjectModel(EnergyBalance.name)
    private readonly balanceModel: Model<EnergyBalance>,
    private readonly reeClient: ReeClientService,
  ) {}

  private async fetchMissingData({ start, end }: { start: Date; end: Date }) {
    try {
      const exists = await this.balanceModel.exists({
        startDate: start,
        endDate: end,
      });

      if (exists) {
        this.logger.log(
          `ㄟ( ▔, ▔ )ㄏ Data already exists for range: ${start} - ${end}`,
        );
        return;
      }

      const rawData = await this.reeClient.fetchData({ start, end });
      this.logger.log(
        `（*＾-＾*） Fetched data from REE balance: ${rawData.length}`,
      );
      if (!rawData?.length) {
        throw new Error('API returned empty dataset');
      }

      await this.balanceModel.insertMany(rawData);
      this.logger.log(`(^_-)db(-_^) Saved data: ${rawData.length}`);
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  async getBalances({
    startDate,
    endDate,
    groupId,
    type,
    groupType,
  }: {
    startDate: string;
    endDate: string;
    groupId?: string;
    type?: string;
    groupType?: string;
  }) {
    this.logger.log(
      `[1] Received params: \n startData:${startDate} endDate:${endDate}`,
    );

    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T23:59:59Z`);

    this.logger.log(
      `[2] Converted to Date: \n startData:${start} endDate:${end}`,
    );

    await this.fetchMissingData({ start, end });

    // Build the Mongo query once, declaratively, including every supported filter.
    // NOTE: `groupType` lives inside the embedded `attributes` object on the
    // schema, not at the top level, so we use dot-notation here.
    const query: FilterQuery<EnergyBalance> = {
      startDate: { $gte: start },
      endDate: { $lte: end },
      ...(groupId && { groupId }),
      ...(type && { type }),
      ...(groupType && { 'attributes.groupType': groupType }),
    };

    this.logger.log(`[3] Query MongoDB: ${JSON.stringify(query)}`);

    const data = await this.balanceModel.find(query).exec();
    this.logger.log(`[4] Data obtained from MongoDB: ${data.length}`);

    return data;
  }
}
