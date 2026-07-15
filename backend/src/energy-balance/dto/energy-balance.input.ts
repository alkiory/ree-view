import { InputType, Field } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { IsMaxDaysRange } from '../../common/validators/is-max-days-range.validator';
import { MAX_DATE_RANGE_DAYS } from './dto.constants';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@InputType()
export class EnergyBalanceInput {
  @Field({ description: 'Start date in YYYY-MM-DD format' })
  @IsString()
  @IsNotEmpty()
  @Matches(DATE_PATTERN, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  startDate: string;

  @Field({ description: 'End date in YYYY-MM-DD format' })
  @IsString()
  @IsNotEmpty()
  @Matches(DATE_PATTERN, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  @IsMaxDaysRange(MAX_DATE_RANGE_DAYS, {
    message: `endDate must be at most ${MAX_DATE_RANGE_DAYS} days after startDate`,
  })
  endDate: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupType?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupId?: string;
}
