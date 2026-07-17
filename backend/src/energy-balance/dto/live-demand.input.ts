import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { IsEnum, IsISO8601, IsOptional, MaxLength } from 'class-validator';

/**
 * Slugs canónicos que aceptamos en el campo `region` de los inputs
 * live/histórico. Acepta cualquier casing/string suelto (Display
 * kebab, kebab-lowercase o enum value) y el service layer lo
 * normaliza al enum value.
 */
export enum LiveDemandRegionSlug {
  NACIONAL = 'NACIONAL',
  PENINSULAR = 'PENINSULAR',
  BALEARES = 'BALEARES',
  CANARIAS = 'CANARIAS',
  CEUTA = 'CEUTA',
  MELILLA = 'MELILLA',
}

registerEnumType(LiveDemandRegionSlug, {
  name: 'LiveDemandRegionSlug',
  description:
    'Slugs canónicos de las zonas geográficas de demanda (REE apiDatos).',
  valuesMap: {
    NACIONAL: {
      description:
        'Agregado nacional (omit `geo_limit` en llamada REE). Default fallback.',
    },
    PENINSULAR: {
      description: 'Subsistema peninsular (REE `?geo_limit=peninsular`).',
    },
    BALEARES: {
      description: 'Subsistema Islas Baleares (REE `?geo_limit=baleares`).',
    },
    CANARIAS: {
      description: 'Subsistema Islas Canarias (REE `?geo_limit=canarias`).',
    },
    CEUTA: { description: 'Subsistema Ceuta (REE `?geo_limit=ceuta`).' },
    MELILLA: { description: 'Subsistema Melilla (REE `?geo_limit=melilla`).' },
  },
});

/**
 * Input para `getLiveSnapshot`. `region` opcional: omitirla = Nacional
 * implícito (la API REE no acepta un `geo_limit=nacional` válido).
 */
@InputType()
export class GetLiveSnapshotInput {
  @Field(() => LiveDemandRegionSlug, { nullable: true })
  @IsOptional()
  @IsEnum(LiveDemandRegionSlug, {
    message:
      'region debe ser uno de: nacional | peninsular | baleares | canarias | ceuta | melilla',
  })
  region?: LiveDemandRegionSlug;
}

/**
 * Input para `getHistoricalHourlySnapshot`. `date` es fecha en ISO 8601
 * (`YYYY-MM-DD`); `region` opcional con la misma semántica que live.
 */
@InputType()
export class HistoricalHourlyInput {
  @Field(() => String)
  @IsISO8601(
    { strict: true },
    { message: 'date debe ser ISO 8601 estricto (YYYY-MM-DD)' },
  )
  @MaxLength(10)
  date: string;

  @Field(() => LiveDemandRegionSlug, { nullable: true })
  @IsOptional()
  @IsEnum(LiveDemandRegionSlug, {
    message:
      'region debe ser uno de: nacional | peninsular | baleares | canarias | ceuta | melilla',
  })
  region?: LiveDemandRegionSlug;
}
