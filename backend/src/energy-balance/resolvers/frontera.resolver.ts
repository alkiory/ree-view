import { Args, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FronteraInput } from '../dto/frontera.input';
import { FronteraType } from '../dto/frontera.type';
import { FronteraService } from '../services/frontera.service';

@Resolver()
export class FronteraResolver {
  constructor(private fronteraService: FronteraService) {}

  @Query(() => [FronteraType])
  async getIntercambios(@Args('input') rawInput: FronteraInput) {
    const input = plainToInstance(FronteraInput, rawInput);
    const errors = await validate(input, { whitelist: true });
    if (errors.length > 0) {
      const messages = errors.flatMap((e) =>
        Object.values(e.constraints ?? {}),
      );
      throw new BadRequestException(messages);
    }

    return await this.fronteraService.getIntercambiosFrontera({
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }
}
