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

// TTL de 24h sobre `createdAt` (autogenerado por `timestamps: true` en la
// clase Frontera). ESTE índice es el substituto correcto al propuesto
// inicialmente sobre `endDate`/`startDate` porque esos son campos
// HISTÓRICOS: si el usuario consulta datos de 2023, el `endDate` ya está
// en el pasado y MongoDB expira el documento inmediatamente, destruyendo
// la caché antes de que pueda ser reutilizada. `createdAt` mide tiempo
// desde la inserción, que sí es relativo al presente.
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 86_400;
FronteraSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: CACHE_TTL_SECONDS, name: 'ree_view_ttl_createdAt' },
);
