import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class EnergyBalance extends Document {
  @Prop({ type: Date, required: true, index: true })
  startDate: Date;

  @Prop({ type: Date, required: true, index: true })
  endDate: Date;

  @Prop()
  type: string;

  @Prop()
  groupId: string;

  @Prop({ type: Object })
  attributes: {
    title: string;
    description: string;
    color: string;
    icon: null | string;
    type: string;
    magnitude: null | string;
    composite: boolean;
    lastUpdate: Date;
    values: Array<{
      value: number;
      percentage: number;
      datetime: string;
    }>;
    total: number;
    totalPercentage: number;
    groupId: string;
    groupType: string;
  };

  @Prop({ type: [{ value: Number, percentage: Number, datetime: Date }] })
  values: { value: number; percentage: number; datetime: Date }[];
}

export const EnergyBalanceSchema = SchemaFactory.createForClass(EnergyBalance);

const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 86_400;
EnergyBalanceSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CACHE_TTL_SECONDS, name: 'ree_view_ttl_createdAt' },
);
