import { Query, Resolver, Args } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { EnergyBalanceService } from '../services/energy-balance.service';
import { EnergyBalanceType } from '../dto/energy-balance.type';
import { EnergyBalanceInput } from '../dto/energy-balance.input';

@Resolver(() => EnergyBalanceType)
export class EnergyBalanceResolver {
  constructor(private balanceService: EnergyBalanceService) {}

  @Query(() => [EnergyBalanceType])
  async getEnergyBalances(@Args('input') rawInput: EnergyBalanceInput) {
    // Salvaguarda: la ValidationPipe global no es 100% confiable con
    // `autoSchemaFile` en NestJS GraphQL 13. Forzamos validación manual.
    const input = plainToInstance(EnergyBalanceInput, rawInput);
    const errors = await validate(input, { whitelist: true });
    if (errors.length > 0) {
      const messages = errors.flatMap((e) =>
        Object.values(e.constraints ?? {}),
      );
      throw new BadRequestException(messages);
    }

    if (new Date(input.startDate) > new Date(input.endDate)) {
      throw new BadRequestException('⚠️ Start date must be before end date.');
    }

    const data = await this.balanceService.getBalances({
      startDate: input.startDate,
      endDate: input.endDate,
      groupId: input.groupId,
      type: input.type,
      groupType: input.groupType,
    });
    if (!data) {
      throw new BadRequestException(
        '⚠️ No data found for the given date range.',
      );
    }

    return data;
  }
}
