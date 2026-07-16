import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { IsEnum, IsISO8601, IsOptional, MaxLength } from 'class-validator';

/**
 * Slugs canónicos que aceptamos en el campo `region` de los inputs
 * live/histórico. Importante: la fuente de verdad visual es
 * `frontend/src/libs/design-tokens.ts:REGIONS` — cualquier cambio
 * allí debe reflejarse aquí. Por ahora los alineamos a mano (kebab
 * case porque es lo que REE acepta en `?geo_limit=`).
 *
 * El mapping exacto es:
 *   'Nacional'   → 'nacional'  (frontend manda nacional) — backend omite `geo_limit`
 *   'Peninsular' → 'peninsular'
 *   'Baleares'   → 'baleares'
 *   'Canarias'   → 'canarias'
 *   'Ceuta'      → 'ceuta'
 *   'Melilla'    → 'melilla'
 *
 * Por qué enum GraphQL separado y no `String` libre:
 *   - `class-validator: @IsOptional @IsEnum(...)` rechaza valores
 *     typos antes de llegar al servicio.
 *   - GraphQL envía un `enum` real al resolver, así frontend no
 *     necesita mandar literal kebab-case accidental.
 *   - El round-trip con kebab-case se centraliza aquí; cualquier
 *     normalización adicional (lowercase, uppercase first letter) es
 *     trivial en único punto.
 */
export enum LiveDemandRegionSlug {
  NACIONAL = 'NACIONAL',
  PENINSULAR = 'PENINSULAR',
  BALEARES = 'BALEARES',
  CANARIAS = 'CANARIAS',
  CEUTA = 'CEUTA',
  MELILLA = 'MELILLA',
}

/**
 * Phase 2 §3.31 — GraphQL enum registration. Sin él, NestJS schema
 * builder falla al boot con `CannotDetermineOutputTypeError` porque las
 * 3 `@Field(() => LiveDemandRegionSlug, ...)` decoran `@ObjectType` /
 * `@InputType` sin un output type resolvable.
 *
 * Co-ubicado aquí (junto a la declaración del enum) para que cualquier
 * modificación de region variants vea la llamada adyacente. Module load
 * ejecuta el `registerEnumType` antes de que el schema builder corra,
 * por lo que ubicarlo aquí es safe y previene drift.
 *
 * Regla duradera: cualquier enum backend expuesto en contrato GraphQL
 * debe tener `registerEnumType(...)` + `valuesMap` con descripciones por
 * valor (no decorativo: las descripciones salen en Apollo Studio +
 * GraphQL Playground introspection).
 */
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
 * Input para `getLiveSnapshot`. Region es opcional: omitir u omitirlo
 * significa "Nacional" (la API REE no acepta un `geo_limit=nacional`
 * válido — usamos ausencia del query param).
 *
 * Por qué el campo es opcional y no `default 'nacional'`:
 *   - Compatibilidad backwards con frontend que aún no envía region
 *     (versión sin picker enviada antes de Fase 2).
 *   - Tests de regresión pueden construir inputs sin region.
 *
 * Si en el futuro queremos forzar region obligatoria (rotura
 * intencional del backward-campat), cambiar a `@IsEnum` (sin
 * `@IsOptional`) aquí + eliminar fallback en `LiveDemandService`.
 */
@InputType()
export class GetLiveSnapshotInput {
  // ⛔ No default literal — `class-validator:@IsOptional` requiere NO
  // valor en runtime. El service layer mapea undefined → 'nacional'.
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
 * (YYYY-MM-DD); `region` opcional con misma semántica que live.
 *
 * Por qué nuevo DTO separado y NO reutilizar GetLiveSnapshotInput:
 *   La semántica es distinta (live = "ahora", historical = fecha pasada).
 *   Mantener DTOs separados evita que un cliente mande `date` a live o
 *   `region` sin date a historical con un shape ambiguo.
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
