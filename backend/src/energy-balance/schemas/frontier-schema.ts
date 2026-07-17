import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Frontera extends Document {
  @Prop({ type: String, required: true, index: true })
  type: string;

  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String, required: true, index: true })
  groupId: string;

  @Prop({ type: Object })
  attributes: {
    title?: string;
    description?: string;
    color?: string;
    icon?: string;
    type?: string;
    magnitude?: string;
    composite: boolean;
    lastUpdate?: string;
    values?: Array<{
      value: number;
      percentage: number;
      datetime: string;
    }>;
    total?: number;
    totalPercentage?: number;
  };

  @Prop({ type: String, index: true })
  country: string;

  @Prop({ type: Date, index: true })
  startDate: Date;

  @Prop({ type: Date, index: true })
  endDate: Date;
}

export const FronteraSchema = SchemaFactory.createForClass(Frontera);

const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 86_400;
FronteraSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CACHE_TTL_SECONDS, name: 'ree_view_ttl_createdAt' },
);
