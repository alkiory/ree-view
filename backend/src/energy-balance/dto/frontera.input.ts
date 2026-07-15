import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

import { IsMaxDaysRange } from '../../common/validators/is-max-days-range.validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATE_RANGE_DAYS = Number(process.env.MAX_DATE_RANGE_DAYS) || 90;

@InputType()
export class FronteraInput {
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
}
