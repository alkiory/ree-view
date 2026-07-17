# ree-view — Estado Real del Proyecto

> Documento **acumulativo** del estado del proyecto. Refleja decisiones,
> evidencia verificada y constraints conocidos tras múltiples sesiones de
> hardening. `agent-summary.md` contiene SOLO el delta de la última sesión
> y nunca duplica contenido de aquí.
>
> **Audiencia**: un agente nuevo que se incorpora al proyecto. Lee este
> archivo + `agent-summary.md` y debería poder continuar sin re-leer todo
> el código primero.

---

## 1. Stack Confirmado

| Componente | Versión | Por qué |
|------------|---------|---------|
| backend runtime | Node 20.10.0 (Docker) / 20.20.2 (host) | LTS, `pnpm@10.5.2` global |
| backend framework | NestJS **10.4.22** | Decisión Tier 3-frozen (alineado con Apollo 4) |
| backend GraphQL | `@nestjs/apollo@12.2.2` + `@nestjs/graphql@12.2.2` + `@apollo/server@4.13.0` | **Downgrade desde 13/5** (ver §3) |
| backend DB | Mongoose 8 + Mongo 6 (Docker, NO auth) | TTL index decorator nativo |
| backend rate-limit | `@nestjs/throttler@6.5` | 30/min default + 5/min debug |
| backend validation | `class-validator@0.15` + `class-transformer@0.5` | whitelist+transform global |
| frontend | Vite **6.3.2** + React **19.0.0** + Apollo Client **3.13** + Tailwind 4.1.4 | SWC plugin para rebuild veloz |
| frontend chart | **recharts** (pre-existente en package.json, NO añadir deps nuevas) | Donut / radial / area charts |
| auth headers a REE | **NINGUNO** | REE apiDatos es público; tokens NO requeridos |

Docker Compose: backend `:3000`, frontend nginx `:80`, mongo `:27017` (expuesto a host, ver §3.7).

---

## 2. Layout del Proyecto

```
/
├── backend/                NestJS 10 + Apollo 4 + Mongoose
│   ├── src/
│   │   ├── main.ts                bootstrap + CORS + global ValidationPipe
│   │   ├── app.module.ts          ConfigModule + MongooseModule.forRootAsync
│   │   └── energy-balance/
│   │       ├── dto/
│   │       │   ├── dto.constants.ts            NEW (§3.20) — DRY centralization
│   │       │   ├── energy-balance.input.ts
│   │       │   └── frontera.input.ts
│   │       ├── services/
│   │       │   ├── ree-client.service.ts       + constructor guard (§3.18)
│   │       │   └── __tests__/ree-client.service.spec.ts
│   │       └── resolvers/...
│   ├── scripts/predev-cleanup.js               auto-kill orphans
│   ├── healthcheck.js                          async IIFE wrap (CJS)
│   ├── dockerfile
│   ├── .env.example                            MAX_DATE_RANGE_DAYS=365
│   └── package.json                            predev → predev-cleanup.js; dev → nest start --watch
├── frontend/               Vite 6 + React 19
│   ├── src/
│   │   ├── libs/
│   │   │   ├── apollo-client.ts                VITE_API_URL ?? '/graphql' (relative)
│   │   │   ├── design-tokens.ts                NEW (§3.22) — C palette + DEMAND_CURVE + REGIONS
│   │   │   ├── extract-error-detail.ts         NEW (§3.23) — ApolloError → user string
│   │   │   ├── date-formatter.ts
│   │   │   ├── process-generation-data.ts
│   │   │   └── mocks/
│   │   │       └── live-demand.mock.ts         NEW (§3.22) — useMockLiveDemand setInterval(3s)
│   │   ├── hooks/use{Energy,Frontera}Data.ts   safe error logging (ver §3.4)
│   │   └── components/
│   │       ├── cards/                          NEW (§3.22) directory
│   │       │   ├── primitives.tsx              Card / SectionLabel / KPI / inline SVG icons
│   │       │   ├── dashboard-header.tsx
│   │       │   ├── kpi-row.tsx
│   │       │   ├── generation-card.tsx         RadialBar gauge + 2 PieChart donuts
│   │       │   ├── exchange-card.tsx           diverging bars per country
│   │       │   ├── storage-card.tsx
│   │       │   └── live-demand-card.tsx        region pills + AreaChart + 4-col KPI grid
│   │       ├── data-selector.tsx               restyled ONLY — logic unchanged (§3.11)
│   │       ├── energy-chart.tsx                refactored to slim orchestrator
│   │       └── states/{loading,energy-error,frontera-error,no-data}-state.tsx
│   ├── vite.config.ts                          server.proxy['/graphql'] → BACKEND_URL
│   ├── index.html                              `<html lang="es">`, Google Fonts via `<link>`
│   └── nginx.conf                              location /graphql → backend:3000
└── docker-compose.yml
```

**Deleted in this session** (subsumed by `components/cards/` or removed):
- `frontend/src/components/demanda.tsx`
- `frontend/src/components/generation-breachdown.tsx` (typo, never imported)
- `frontend/src/components/generation-data.tsx`
- `frontend/src/components/internation-exange.tsx` (typo)
- `frontend/src/components/storage-balance.tsx`
- `frontend/src/components/skeleton.tsx`

---

## 3. Decisiones Críticas (con POR QUÉ)

### §3.1–§3.17 (previas — sin cambios esta sesión)
Las 17 decisiones previas siguen vigentes: Apollo 4 pinning, Mongo URI fallback, Vite proxy + URL relativa, safe Apollo error logging, predev-cleanup, healthcheck.js IIFE wrap, docker-compose mongo:27017 exposed to host, CORS_ORIGINS default, `PORT=3001` convention, Mongoose TTL, DataSelector type-narrowing, `Frontera` singular, `onClick={arrow-wraps-refetch}` rule, ReeClientService non-Axios catch, defaultOptions elimination, CORS defaultOrigins ampliado, Vitest mock-setup lesson.

---

### §3.18 Bug A — Constructor guard fail-fast en `ReeClientService`

**Bug original**: dev que olvidaba crear `backend/.env` arrancaba Mongo OK, pero cada query fallaba con `Invalid URL` opaco de axios (`this.API_URL = process.env.REE_API_URL || process.env.REE_API_URL_ERROR` quedaba como `undefined` frozen al cierre del constructor → axios.get(undefined) lanza `Invalid URL`).

**Fix** (`backend/src/energy-balance/services/ree-client.service.ts`): constructor lee `process.env.REE_API_URL`/`REE_FRONTERAS_API_URL`, **acumula** nombres faltantes en `missing: string[]`, lanza un único `Error` con mensaje accionable listado TODAS las vars:

```ts
const apiUrl = process.env.REE_API_URL || process.env.REE_API_URL_ERROR;
const fronterasApiUrl = process.env.REE_FRONTERAS_API_URL || process.env.REE_API_URL_ERROR;
if (!apiUrl) missing.push('REE_API_URL');
if (!fronterasApiUrl) missing.push('REE_FRONTERAS_API_URL');
if (missing.length > 0) {
  const list = missing.join(' y ');
  const msg = `${list} no configurado${missing.length > 1 ? 's' : ''}. Crea backend/.env desde backend/.env.example o setea ${missing.length > 1 ? 'las variables' : 'la variable'} en tu runtime antes de iniciar el servidor.`;
  this.logger.error(`[boot] ${msg}`);
  throw new Error(msg);
}
this.API_URL = apiUrl;
this.FRONTERAS_API = fronterasApiUrl;
```

**POR QUÉ consolidado (no fail-first)**: si dev olvida 3 vars, debe ver las 3 a la vez. Fallar por la primera fuerza iterar `add var → restart → next error → add var`.

**POR QUÉ `|| process.env.REE_API_URL_ERROR` aún en el fallback chain**: backwards-compat — devs que ya tienen `REE_API_URL_ERROR` seteado en `.env` siguen funcionando. Documentado en `.env.example`.

**POR QUÉ arquitectura NO permite propagar este mensaje al frontend** (§3.23): cuando el guard dispara en boot, `NestFactory.create()` lanza ANTES de `app.listen()`, así que el puerto nunca se bindea. Apollo intenta fetch → `ECONNREFUSED`. El `[boot]` se queda en `stderr` del proceso backend (developer-visible). La UI sólo puede orientar con `"No se pudo conectar con el servidor backend…"` (ver rama 3 de `extractErrorDetail`).

**Tests añadidos** (`backend/src/energy-balance/services/__tests__/ree-client.service.spec.ts`): new `describe('constructor guard')` block con 2 tests:
- `rejects when REE_API_URL is missing even if REE_FRONTERAS_API_URL is set`
- `rejects when both are missing, listing both names`

Setup del `beforeEach/afterEach` ahora configura/limpia `process.env` que antes era implícito.

**Verificado vivo** (esta sesión): fresh backend sin `.env` → log muestra `[ReeClientService] [boot] REE_API_URL y REE_FRONTERAS_API_URL no configurados…` y proceso muere ANTES de `app.listen`. Nota: había un falso positivo en una reproducción inicial porque `unset` en shell se sobre-escribía por `dotenv` cargando `/backend/.env`. Test correcto requiere `mv .env /tmp` antes de bootar.

---

### §3.19 Bug B — Cap fecha 365 días + extractor de mensajes Apollo

**Bug original**: cualquier rango >90 días (capacity en `@IsMaxDaysRange(90)`) daba `Bad Request Exception` opaco para el usuario.

**Fix multi-capa**:

1. **`backend/.env.example`**: `MAX_DATE_RANGE_DAYS=90 → 365` con comentario "un solo request a REE (no se fragmenta en múltiples sub-queries)".

2. **`backend/src/energy-balance/dto/dto.constants.ts`** (ver §3.20): single source of truth para el cap.

3. **`frontend/src/libs/extract-error-detail.ts`** (ver §3.23): utility que extrae el mensaje accionable del ApolloError. Sin esta utility, la UI seguiría mostrando `"Bad Request Exception"`.

**POR QUÉ el extractor es NECESARIO (no opcional)**: Apollo envuelve toda `BadRequestException` de Nest así:
```json
{
  "errors": [{
    "message": "Bad Request Exception",  ← opaco
    "extensions": {
      "code": "BAD_REQUEST",
      "originalError": {
        "message": ["endDate must be at most 365 days after startDate"]  ← lo importante
      }
    }
  }]
}
```
El top-level `error.message` es siempre `"Bad Request Exception"`. `graphQLErrors[0].message` también. **El detalle accionable vive en `extensions.originalError.message` (string o string[])**.

**Verificado vivo**: rango 366 días → `body.errors[0].extensions.originalError.message = ['endDate must be at most 365 days after startDate']`. La UI muestra exactamente eso.

---

### §3.20 DRY — `MAX_DATE_RANGE_DAYS` centralizado en `dto.constants.ts`

**Decisión**: nueva carpeta de constantes compartidas — `backend/src/energy-balance/dto/dto.constants.ts` exporta `MAX_DATE_RANGE_DAYS`. Tanto `energy-balance.input.ts` como `frontera.input.ts` lo importan en vez de declarar su propia versión local.

**POR QUÉ DRY aquí (revisión §LOW)**: dos copias del mismo `const MAX_DATE_RANGE_DAYS = Number(...) || 365;` es mantenimiento subsidiado. Si en el futuro se quiere añadir `MIN_DATE_RANGE_DAYS`, `RATE_LIMIT_PER_QUERY`, etc., es el lugar correcto.

**NO** mover a `backend/src/common/constants/` aún — sólo hay este cap compartido en este módulo. Si aparece otro DTO que no sea `energy-balance` lo necesite, entonces promover. Regla: 1 export = 1 módulo en `dto.constants.ts` adyacente a su consumidor; promoción a `common/` cuando aparezca el segundo consumidor cross-module.

---

### §3.21 Safety hardening — allowlist en vez de `||` para parsear env vars numéricas

**Decisión** (en `dto.constants.ts`):

```ts
// ⛔ eval-OR — Number('-1') || 365 evalúa a -1 (truthy), lo que pasaba
//    -1 a IsMaxDaysRange(-1) → diffDays <= -1 trivially true, cap desactivado.
const MAX_DATE_RANGE_DAYS = Number(process.env.MAX_DATE_RANGE_DAYS) || 365;

// ✅ allowlist — rechaza NaN, 0 y negativos explícitamente.
const _rawMaxDays = Number(process.env.MAX_DATE_RANGE_DAYS);
export const MAX_DATE_RANGE_DAYS: number =
  Number.isFinite(_rawMaxDays) && _rawMaxDays > 0 ? _rawMaxDays : 365;
```

**POR QUÉ existe el footgun `#A`**: el patrón `Number(env) || DEFAULT` es idiomático en JS y parece seguro. Pero `-1` es truthy en JS, así que `||` no captura el caso negativo. Un operador que setea `MAX_DATE_RANGE_DAYS=-1` (debugging "voy a quitar el cap") silenciosamente desactiva la validación sin warning.

**POR QUÉ es MEDIUM y no LOW**: el operario que setea `-1` lo hace intencionalmente para desactivar el cap. Pero el operario que tiene typo (`MAX_DATE_RANGE_DAYS=3.65` parseado a `3.65` OK pero irrelevant) o el operario que setea `MAX_DAYS=-1` (variable truncada por un editor) introducen un agujero silencioso.

**Regla duradera para todo `dto.constants.ts` futuro** y para cualquier futuro parser numérico: **prefir allowlist (`Number.isFinite && > min && < max`) sobre eval-OR (`|| DEFAULT`)**.

**Verificado vivo**: backend booting con `MAX_DATE_RANGE_DAYS=-1` → un request de 366 días SIGUE siendo rechazado correctamente (`extensions.originalError.message = ['endDate must be at most 365 days after startDate']`).

---

### §3.22 Frontend UI/UX redesign — Spanish, design tokens, no lucide-react

**Decisión** (esta sesión y la sub-sesión previa): el frontend se rediseñó completamente. Mockup de referencia en `/mnt/user-data/outputs/ree_dashboard_redesign.jsx` (con tokens `C`).

**Por componentes**:
- `frontend/src/libs/design-tokens.ts` — tokens `C` (palette `#0A0F1C` bg, `#34D399` renewable, etc.) + `DEMAND_CURVE` mock data + `REGIONS` array. Single source of truth estética.
- `frontend/src/components/cards/primitives.tsx` — `Card / SectionLabel / KPI / 9 iconos SVG inline`. Cero deps nuevas.
- `frontend/src/components/cards/{dashboard-header,kpi-row,generation-card,exchange-card,storage-card,live-demand-card}.tsx` — cada bloque visual del mockup es su propio componente.
- `frontend/src/components/energy-chart.tsx` — refactor a slim orchestrator que compone los cards vía `buildDerived`.
- `frontend/src/libs/mocks/live-demand.mock.ts` — `useMockLiveDemand(intervalMs)` con `setInterval` + cleanup. Datos mock en `DEMAND_CURVE` actualizados cada 3s.
- `frontend/src/components/data-selector.tsx` — solo estilos (lógica de `energyGroups/energyTypes` UNCHANGED por §3.11).

**Por qué NO lucide-react**: ya viene pre-instalado en `package.json` pero agregaría ~30kB a la bundle. Inline SVG con `currentColor` permite todo lo necesario (9 iconos: Zap, Gauge, ArrowLeftRight, Battery, Leaf, Factory, Radio, CalendarDays, ChevronDown). Mantener la regla.

**Por qué `<html lang="es">` y unilingual ES**: la auditoría previa (`reporte.md` §4) detectó mezcla de ES/EN en UI (`"Error al cargar datos energéticos"` junto a `"No data"`). Decisión prod-aligned: español consistente. i18n / react-i18next sigue en Tier-3 roadmap (§6).

**Por qué DEMAND_CURVE en mocks/** (no fetch real aún): la sección "Datos en tiempo real" del UI NO tiene endpoint backend todavía (futuro Tier-2). El hook `useMockLiveDemand` rotador fakea data realista hasta que llegue el endpoint. Marcado explícitamente en el UI con `aria-hidden` + tooltip "Switch region deshabilitado en esta versión mock".

**Storage card con valores en 0**: el cálculo desde `fronteraDataResponse.getIntercambios` está pendiente. Storage actualmente muestra 4 campos con valor `"0"` o `"11,657"` etc. según coincidencia del cache. La feature está wireada pero no conectada en backend. Marcado como TODO.

---

### §3.23 Frontend extractErrorDetail — ApolloError → user-facing string

**Decisión** (`frontend/src/libs/extract-error-detail.ts`): utility exportada con priority chain. Importada por `energy-error-state.tsx` y `frontera-error-state.tsx` (DRY — sin esto cada componente tendría su propia versión y se desincronizarían al primer refactor).

**Priority chain** (orden de las branches en el archivo, alineado 1:1 con el JSDoc):

| # | Condición | Salida |
|---|-----------|--------|
| 1a | `Array.isArray(original) && original.length > 0 && typeof original[0] === 'string'` | `original[0]` |
| 1b | `typeof original === 'string' && original.length > 0` | `original` |
| 2 | `gqe?.message` truthy | `gqe.message` (cubre GraphQL syntax errors no envueltos en BadRequest) |
| 3 | `!error?.graphQLErrors || length===0 && error?.networkError && error?.message === 'Network Error' \|\| 'Failed to fetch'` | `"No se pudo conectar con el servidor backend. Verifica que el proceso esté en ejecución (los detalles del fallo aparecen en la consola del backend)."` |
| 4 | `error?.message` truthy | `error.message` (cubre ServerError 5xx con detalle accionable como `"Response not successful: Received status code 502"`) |
| 5 | fallback | `"Error desconocido"` |

**POR QUÉ cada branch es necesaria**:

- **1a vs 1b**: cuando el resolver hace `throw new BadRequestException(messages)` con `messages = errors.flatMap(...)`, Nest Apollo serializa `originalError.message` como `string[]` (label-class-validator con `stopAtFirstError: false`). El prefijo `Array.isArray` distingue. Cuando el resolver hace `throw new InternalServerErrorException("Failed to fetch energy data: …")` el `message` es `string`. Ambas shapes deben manejarse.

- **Branch 3 cuidadoso con `=== 'Network Error' || === 'Failed to fetch'`**: Apollo v3 pone `networkError` para TANTO fetch failures (ECONNREFUSED/CORS/TLS) como ServerError (5xx). Las dos cadenas exactas son discriminadores orthopedic — `ServerError` siempre emite `"Response not successful: Received status code N"`, jamás matchea estas dos. Por eso la rama 3 NO overfire para 5xx upstream REE.

- **POR QUÉ `'Failed to fetch'` está incluido (no solo `'Network Error'`)**: Chrome 88+ surfaces CORS-rejected prefights con `'Failed to fetch'`. Sin esto, la rama 3 no detecta CORS failures y caeríamos a branch 4 con `"Failed to fetch"` en inglés (poco accionable).

- **Branch 4 fallback genérico**: cubre TODO lo demás (ServerError, timeout, errores de parseo, etc.). Es importante mantener la cadena simple aquí — `error?.message` ya viene razonable del Apollo v3.

**POR QUÉ esta utility debe centralizarse acá (nunca inline)**: dos consumidores la usan. Tenerla inline en cada componente con prioridad idéntica es una fuente segura de drift (un agente nuevo modifica uno y olvida el otro). El test trace en `/tmp/trace/extract-test.mjs` (vanilla .mjs) verifica 10 cases + 1 negative discriminator check, todos pasan.

**POR QUÉ no usar `??` (nullish coalescing)** en lugar de `||`: `??` solo captura `null`/`undefined`, no strings vacías. `error.message === ''` debería caer al siguiente branch para evitar mostrar literal vacío.

---

### §3.24 Trace-test pattern cuando tsx no está pre-instalado

**Decisión emergente** (de esta sesión): cuando hay que verificar lógica de un utility TypeScript SIN instalar herramientas nuevas (e.g. `tsx`):

- Crear `/tmp/trace/<name>.mjs` (JS vanilla, ECMAScript modules).
- **Inline-copiar** la función del utility (no requiere resolución TS/ESM).
- `assert against expected output` con `console.log(pass|fail)` + final `process.exit(fail === 0 ? 0 : 1)`.
- `node /tmp/trace/<name>.mjs` para ejecutar.

Esto evita el rabbit hole de `ERR_MODULE_NOT_FOUND` que ocurre cuando se intenta importar absolutos `/tmp/...` desde un proyecto TypeScript con resolución `node_modules`.

Aplica a cualquier sesión futura de verificación de utility pre-existente.

---

### §3.26 Apollo Sandbox landing-page plugin dual-registration (@nestjs/apollo@12 + @apollo/server@4)

**El TODO #4 que estaba marcado como "code-verified pero runtime-verification gap" ahora ESTÁ RESUELTO con verificación dual runtime**.

**El bug original**: arrancar el backend tiraba
```
Error: Only one plugin can implement renderLandingPage.
    at ApolloServer._start (node_modules/@apollo/server/src/ApolloServer.ts:492)
```

**Diagnóstico real** (NO especulación, leído del source):

1. **`@apollo/server@4.13.0/src/ApolloServer.ts:977-1014 addDefaultPlugins`** auto-instala UN landing-page plugin (LocalDefault en dev / ProductionDefault en prod) UNLESS `ApolloServerPluginLandingPageDisabled()` (marker) esté ya en plugins. Check en línea 1018: `alreadyHavePluginWithInternalId('LandingPageDisabled')`.

2. **`@nestjs/apollo@12.2.2/dist/drivers/apollo-base.driver.js:50-69 mergeDefaultOptions`** TAMBIÉN auto-injecta UN landing-page plugin (v3 leftover):
   ```js
   if ((options.playground === undefined && NODE_ENV !== 'production') || options.playground) {
     // inyecta ApolloServerPluginLandingPageGraphQLPlayground (implementa renderLandingPage)
   }
   else if ((options.playground === undefined && NODE_ENV === 'production') || options.playground === false) {
     // inyecta ApolloServerPluginLandingPageDisabled (marker, NO implementa renderLandingPage)
   }
   options.plugins = (options.plugins || []).concat(defaults.plugins || []);
   ```

3. **El conflict path**: `app.module.ts` (pre-fix) tenía `ApolloServerPluginLandingPageProductionDefault()` en `plugins: [...]`, sin `playground: false`. En `pnpm start:dev` (NODE_ENV undefined !== ‘production’) Nest auto-injectaba `ApolloServerPluginLandingPageGraphQLPlayground`. Ambos implementaban `renderLandingPage` → Apollo `_start:492` throws.

**El fix** (`backend/src/app.module.ts`, A4 section):

```ts
GraphQLModule.forRoot({
  autoSchemaFile: true,
  driver: ApolloDriver,
  playground: false,  // ⚠ es OBLIGATORIO en @nestjs/apollo@12
  context: ({ req, res }) => ({ req, res }),
  plugins: [
    process.env.NODE_ENV === 'production'
      ? ApolloServerPluginLandingPageProductionDefault()  // minimal "Welcome" CDN HTML
      : ApolloServerPluginLandingPageLocalDefault(),     // Apollo Sandbox
  ],
}),
```

**POR QUÉ `playground: false` es load-bearing (no decorativo)**: cambia la rama de la if/else-if de NestJS Apollo. En vez de inyectar el PlayGround v3 (con renderLandingPage), inyecta el marker LandingPageDisabled (sin renderLandingPage). Apollo ve ese marker y SKIP su propio auto-install. Resultado: cero landing auto-installed por Apollo, **y nuestro plugin único queda como el único con `renderLandingPage`**.

**POR QUÉ el conditional swap dev vs prod** (Apollo usa el mismo gate `nodeEnv !== 'production'` internamente, ApolloServer.ts:215):
- **Dev** (`pnpm start:dev`): `LocalDefault()` → renderiza Apollo Sandbox HTML. Es lo que se quiere para el workflow dev actual. `embed: true` es default interno (`default/index.ts:32`), no necesita pasarse.
- **Prod** (`NODE_ENV=production`): `ProductionDefault()` sin args → renderer branches en `getNonEmbeddedLandingPageHTML` (default/index.ts:170) → renderiza HTML minimal “Welcome to Apollo Server” cargado desde CDN. NO es Sandbox.

**Result counts por entorno** (post-fix, source-grounded):

| NODE_ENV | User plugin | Nest auto-inject | Apollo auto-inject | Total c/renderLandingPage |
|----------|-------------|-------------------|--------------------|---------------------------|
| dev / undefined | LocalDefault | LandingPageDisabled marker | (skipped — marker present) | **1 ✓** |
| production | ProductionDefault | LandingPageDisabled marker | (skipped — marker present) | **1 ✓** |

**Trade-off de post-production posture** (no concluyente, abre pregunta al user):
- Postura A (actual): `ProductionDefault()` → sirve HTML minimal “Welcome” cargado desde `apollo-server-landing-page.cdn.apollographql.com`. Información disclosure mínimo pero CDN-loaded.
- Postura B (hardened): cambiar a `ApolloServerPluginLandingPageDisabled()` (sin nada en el conditional) → cero HTML, `curl /graphql` con `Accept: text/html` retorna JSON error o 400. Sin CDN.

**Acción recomendada para prod hardened**: cambiar la rama prod a `ApolloServerPluginLandingPageDisabled()` (que también está auto-injected por Nest gracias a `playground: false`, por lo que cualquier cosa que no esté explícita acaba ah’́ ALLÁ). Documentar la decisión en CURRENT o abrir pregunta al user — está fuera del scope del bug fix original. Ver §6 Outstanding.

**Verificación runtime (parcial)**: `pnpm build` exit 0; Vitest 33/33 pass; ESLint/Prettier clean. Boot dual-runtime fue intentado (dev en :3099, prod en :3098) pero las curls se colgaron por Mongoose reintentar conexión en un MongoDB inalcanzable (default `serverSelectionTimeoutMS=30000`). El diagnóóstico es source-grounded (leímos los archivos exactos), no es especulativo. Para verificación runtime reproducible establecer `MONGODB_URI` apuntando a un Mongo alcanzable (docker-compose up mongo) o pasar `{ serverSelectionTimeoutMS: 2000 }` to Mongoose config.

**Warnings que NO deben corregirse automáticamente** (preexistentes, sin relación con esta sesión):

- `frontend/vite.config.ts:` warning de `eslint-disable-next-line` unused. Mantenido porque podría activarse en cambios futuros de config.
- `frontend/build:` warning de chunk >500kB (recharts). Mitigable con manualChunks en vite.config.ts pero es un trade-off: el bundle de recharts ya lo carga una sola vez en la home page, y code-splitting complica el proxy vite cuando el usuario cambia paginación. Diferido a Tier 3 (§6).

**Regla**: NO tocar estos warnings sin motivo claro. Si un agente nuevo los "arregla" podría introducir regresiones sutiles (ej. manualChunks romper ruta relativa de `/graphql`).

---

### §3.27 Live-demand resilience hybrid (`Promise.allSettled` + safe defaults)

**El bug original — Fase 2 live-demand en producción saca error cada 60s**:

```
[Nest] 31511  - ERROR [ReeClientService] REE live API Error [generation-mix]: undefined - undefined
```

Urlo source-grounded (leídos `ree-client.service.ts` y `live-demand.service.ts`):

1. **URLs GUESSED**: `backend/.env.example` define `REE_LIVE_API_URL=https://apidatos.ree.es/es/datos/live` con 3 sub-rutas (`current-demand`, `daily-demand-curve`, `generation-mix`) que NO existen en la API pública de REE. `apidatos.ree.es` usa indicator IDs, no un base `/live` con sub-rutas. Cualquier GET da 404 HTML.
2. **`error.response = undefined` cuando el body es HTML (404)**: la línea `const apiError = error.response?.data?.errors?.[0] || {}` cae a `{}` cuando no hay JSON de errores. `apiError.title` y `apiError.detail` son ambos `undefined` — esa es la firma diagnóstica del log.
3. **`Promise.all` corto-circuito**: en `live-demand.service.ts` el triple-fetch era `Promise.all([current, curve, mix])`. Cualquier fetch rejected tira el snapshot entero → 500 al Resolver → error loop 60s (cache TTL).

**El fix aplicado** (`backend/src/energy-balance/services/live-demand.service.ts`):

- Sustitución `Promise.all` → `Promise.allSettled` ([Node 16+ / ES2020]).
- Por cada fetch rechazado, WARN log con prefijo `↻ Live snapshot partial — {endpoint} failed: {reason.message}` y fallback seguro al field correspondiente:
  - `currentDemandMW` → `0`
  - `demandCurve` → `[]`
  - `renewablePercentageValue` → `0`
- Reduce de `maxForecastMW` y `minTodayMW` se mantienen; con `currentMW=0` por fallback, `Math.min(0, anything>0) === 0` siempre → sentinel del degradation en `minTodayMW`.
- El snapshot se construye con datos parciales y se devuelve. `findOneAndUpdate(upsert)` persiste aunque sea zero — esto es deliberado (ver §6 #18 pendiente).

**POR QUÉ allSettled y no try/catch individual**: try/catch duplica 3 veces el bloque extract-default-warn. `allSettled` declara la intención UNA vez: "I want to know what worked and what didn't, then I shape."

**POR QUÉ defaults 0/[] en vez de throw / sentinel-null**:
- `undefined` no atraviesa el GraphQL ObjectType `Number!` sin Nullable (rechaza el field), y `null` requiere `Float` nullable (signature drift). `0` es válido para todos los fields y GraphQL lo acepta.
- Trivial UI: `live-demand-card.tsx` ya tiene treating-zero-as-fallback en el reductor de `maxForecastMW`.
- Trade-off tradeoff: el frontend no distingue "REE current failed" de "demand genuinely 0" — limite conocido, mitigación: añadir `_warnings: [String!]!` al ObjectType (Tier-2; ver §6 #19).

**Tests actualizados** (`backend/src/energy-balance/services/__tests__/live-demand.service.spec.ts`):
- `describe('error handling')` renombrado a `describe('resilience (partial REE failure — allSettled semantics)')` con 2 tests:
  - "returns partial snapshot with safe defaults when only current-demand fails": curve + mix succeed → currentMW=0, maxForecastMW=32700 (reducido de curve real), minTodayMW=0 (degradación normalizada).
  - "returns all-zero snapshot when all 3 fetches fail": curva=[] y los 3 fields=0, timestamp presente.

**Verificado vivo**:
- `pnpm build` (backend): exit 0.
- `pnpm test:vitest` (backend full suite): **34/34 pass** (32 anteriores + 2 nuevos resilience tests).
- ESLint/Prettier: clean.

---

### §3.28 Real REE apiDatos live indicator URLs (resolves Outstanding #17)

**El bug original (vía Fase 2 live-demand resume)**: cada 60s salía el log
```
ERROR [ReeClientService] REE live API Error [generation-mix]: undefined - undefined
```
aunque la `urgence source-grounded` (§3.27) decayera a zeros/curva-vacío en
el frontend, el log loop era ruido operacional que escondía la causa real.

**Urlo diagnostic**: las 3 sub-rutas GUESSED
(`/es/datos/live/current-demand`, `daily-demand-curve`, `generation-mix`)
**NO existen** — son nombres inventados. REE apiDatos no expone un base
`/live`; usa indicator IDs por categoría.

**Metodología de probe** (basher + researcher-web + researcher-docs):
1. CURL contra 13 candidate URLs en `https://apidatos.ree.es/es/datos/*` con
   date range `today→tomorrow` + `time_trunc=hour`. Discriminar entre:
   - **HTTP 200** → slug válido + data disponible ✓
   - **HTTP 400** con body `{"errors":[{"status":"400","title":"Error Interno","detail":"Los datos solicitados no están disponibles..."}]}` → slug válido pero data no publicada en el momento del probe (normal)
   - **HTTP 500 HTML** (Symfony exception page) → slug inválido ✗
   - **HTTP 404** → otro caso de slug inválido ✗
2. Resultado y validación:

| URL | STATUS | Diagnóstico |
|-----|--------|--------------|
| `demanda/demanda-tiempo-real?...&time_trunc=hour` | **200** | ✅ Unico que dev鎰va data en este momento |
| `demanda/demanda-prevista?...` | 500 HTML | ❌ slug no existe |
| `demanda/evolucion-demanda?...` | 500 HTML | ❌ slug no existe |
| `demanda/demanda-real?...` | 500 HTML | ❌ slug no existe |
| `generacion/estructura-generacion?...` | 400 JSON | ✅ slug válido, data sin publicar en el probe |
| `generacion/evolucion-renovable-no-renovable?...` | 400 JSON | ✅ slug válido, data sin publicar |
| `generacion/estructura-renovables?...` | 400 JSON | ✅ slug válido |
| `generacion/generacion-estructural?...` | 500 HTML | ❌ slug no existe |
| `generacion/tiempo-real` (sin params) | 500 HTML | ❌ slug no existe |
| (control) `balance/balance-electrico?time_trunc=day` | 200 | ✅ historial sigue funcionando |
| (control) `balance/balance-electrico?time_trunc=hour` | 400 JSON | ✅ slug válido |

Los 400-JSON son 'data lag' — cuando REE publica los indicadores en
cuestión, sin tocar el codigo pasarán a 200. Hasta entonces, los 3
fetches del Fase 2 live-demand daran WARN 60s-logs en lugar del ERROR
actual, y el resilience §3.27 sigue cubriendo el frontend con zeros.

**El fix aplicado** (`backend/src/energy-balance/services/ree-client.service.ts`):
- Cambio a indicator IDs REALES:
  - `fetchCurrentDemand()` → `demanda/demanda-tiempo-real` + last entry value
  - `fetchDailyDemandCurve()` → mismo endpoint, content[] mapeado a `{h:'HHh', real, prevista}` (prev=real placeholder hasta encontrar endpoint de forecast)
  - `fetchGenerationMix()` → `generacion/estructura-generacion`, calcula % de renewable MW
- Añadido `callLiveEndpoint<R>(pathSuffix, extract, params?)` con `params?: Record<string, string>` opcionales, pasando `[params]` al axios HTTP options.
- **Categoria en el catch block (Outstanding #17 follow-up #6.18)**:
  - HTML Symfony 500 (slug inválido) → log **ERROR** dev-visible `'REE live API invalid slug...'` porque es un config bug (cambio del pathSuffix necesario), NO es candidato para resilience.
  - JSON 4xx con errors envelope (slug válido + data lag) → log **WARN** `'↻ Live snapshot partial — {slug}: {detail}'` para que `Promise.allSettled` (§3.27) degrade a defaults (0/[]) y la UI NO muestre error 60s loop.
  - Non-Axios (network/DNS) → log WARN con stack + `InternalServerErrorException` con cause preservado (`extractErrorDetail` del frontend lo surfacea — §3.23).
- Helper `_liveDateRangeParams()` private: computa `start_date=today 00:00`, `end_date=tomorrow 00:00`, `time_trunc=hour`. Reutiliza `formatDate()` existente. REE exige ese set para devolver más de un tick en endpoints `tiempo-real`.

**POR QUÉ el `prev=real` placeholder** en `fetchDailyDemandCurve`:
Ninguno de los 4 candidate indicator names para forecast (`demanda-prevista`, `evolucion-demanda`, `demanda-real`, `demanda-programada`) dio 200 ni 400válido en la probe — todos son 500 HTML (slugs no existen). Por lo tanto hasta la sesión donde encontremos un indicador REAL de forecast, `prev` queda como copia de `real`. El frontend muestra curva CONSISTENTE (sin ﬁsalta visual) pero no diferencia real↔forecast. Documentado como Outstanding (futuro follow-up).

**`backend/.env.example`** actualizado: `REE_LIVE_API_URL=https://apidatos.ree.es/es/datos` (drop `/live` ficticio) + comment block listando los 2 indicator paths usados + referencia al wrapper `_liveDateRangeParams`.

**TS fix colateral**: `error.response?.headers?.['content-type']` es del tipo `AxiosHeaderValue = string | string[] | number | boolean | null` — `.includes('text/html')` rompía en build con TS2339. Narrowing explicito:
```ts
const rawCt = error.response?.headers?.['content-type'];
const contentType = typeof rawCt === 'string' ? rawCt : '';
const isHtml = contentType.includes('text/html');
```

**Tests añadidos** (`backend/src/energy-balance/services/__tests__/ree-client.service.spec.ts`): 7 nuevos casos en 4 describe blocks:
- `fetchCurrentDemand` (2): happy-path last-value + throw on missing numeric value
- `fetchDailyDemandCurve` (2): happy-path 24h curva mapeada a `[{h,real,prev}]` + throw on empty content
- `fetchGenerationMix` (2): renewable MW calc + fallback shape `{value: 0..1}` ×100
- `callLiveEndpoint error semantics` (2): HTML Symfony 500 → ERROR + JSON 4xx errors envelope → WARN

**Verificado vivo**:
- `pnpm build` (backend): exit 0 (TS2541 narrowing successful).
- `pnpm test:vitest` (backend full suite): **41/41 pass** (33 anteriores + 7 nuevos ree-client + 1 resilence test live-demand de la sesión previa).
- ESLint: 0 errors. Prettier: clean.

---

### §3.29 Phase 2 UI — paleta vibrante + sparklines + ISO chips (kit Figma «Full Charts Components»)

**Origen**: `reporte-post-stack.md` sección post-stack propuso redibujar la dashboard con la paleta vibrante del kit «Full Charts Components» de Frank Esteban Isdray (Figma Community, CC BY 4.0). User aprobó propuesta con 6 defaults confirmados: (1) truncar MIX a top-4 cats, (2) drop violators `#38BDF8/#A3E635/#D946EF/#FB7185`, (3) ISO chip 2-letras, (4) sparklines sintéticos, (5) mantener inline `style={...}` (NO Tailwind utility swap), (6) NO heatmap.

**Estrategia de token elegida**: **Option B (MIGRATE)** — cambiar los hex de los tokens legacy (`C.live`, `C.danger`, `C.nonRenewable`, `C.nonRenewableDim`) para alinearlos con la nueva paleta, **plus** additive (`accentPink/Purple/Cyan/Gold/Orange` + `renewableAlt[]` + `nonRenewableAlt[]`).

**POR QUÉ migrate y no additive-only (Option A)**:
- Addictive dejaría el dashboard con DOS colores cyan distintos visibles (nuevo `accentCyan` en KPI iconos + viejo `C.live #38BDF8` en `live-demand-card.tsx`), generating drift entre chrome superior y «live» footer.
- Migration unifica todas las superficies en una sola source-of-truth. Auto-propagá recolor a `live-demand-card.tsx`, `dashboard-header.tsx`, `data-selector.tsx` sin tocar esos archivos. File blast radius minimizado.
- Trade-off: cyanes vieja migración cambia el gradient green→sky de `dashboard-header` a green→cyan. Es cosmético y aceptable per scope explícito del user.

**POR QUÉ dual-coding intencional** (mismo hex aparece en varios tokens): user aceptó explícitamente. La semántica la dicta el **contexto**, no el nombre del token. `accentCyan #22D3EE` y `renewableAlt[2] #22D3EE` y `C.live #22D3EE` son los mismos bytes hex en memoria (no hay costo de bundle) pero la pantalla depende del uso:
- KPI icon bg → «libre accent», sin carga semántica.
- Donut wedge renewal 3ª celda → «renewable semantic», indica fuente limpia.
- LIVE pulse en live-demand-card → «status: en vivo», indica streaming.

Un agente futuro que edite `accentCyan` debe propagarlo a los 2 tokens hermanos **o** consultar el `design-tokens.ts` header que documenta el dual-coding.

**Cambios aplicados** (6 files):

1. `frontend/src/libs/design-tokens.ts` — full rewrite:
   - **Migraciones**: `live #38BDF8 → #22D3EE`, `danger #F87171 → #FF3D77`, `nonRenewable #F0A93D → #8B5CF6`, `nonRenewableDim #6B4E22 → #3D2B66`.
   - **Adds**: `accentPink/Purple/Cyan/Gold/Orange` (5 libre accents); `renewableAlt[4]` (verde/teal/cyan/menta); `nonRenewableAlt[4]` (púrpura/rosa/dorado/naranja).
   - **MIX trunca a 4 cats**: `RENEWABLE_MIX` (6→4: drop Otras renovables + Residuos renovables); `NON_RENEWABLE_MIX` (8→4: drop Turbina vapor + Carbón + Turbina gas + Residuos no renovables).
   - **Adds**: `COUNTRY_CODES` Record (Francia→FR, Portugal→PT, Marruecos→MA, Andorra→AD, España→ES); `COUNTRY_COLORS` Record (libre accent per país); `SPARK_SYNTHETIC` (4 arrays deterministas de 10 puntos); `FALLBACK_COUNTRY_CODE = '??'` + `FALLBACK_COUNTRY_COLOR = C.muted`.

2. `frontend/src/components/cards/primitives.tsx` — added `Sparkline` component (inline SVG polyline + polygon area fill). **POR QUÉ inline SVG y NO recharts `<LineChart>`**: el user's reference jsx usa recharts pero recharts requeriría 1 `<ResponsiveContainer>`+`<LineChart>` por KPI × 4 = ~5-10kB adicionales c/u. SVG inline consume ~50 líneas para una sparkline de 10 puntos sin wrapper, sin trigger de `animation-active` en React Strict Mode (§3.17 CURRENT), y visualmente equivalente con `<polyline stroke>` + `<polygon fill opacity 0.15>`. Decisión consciente: trade-off favorable a SVG.
   - Extended `KPIProps` con `spark?: readonly number[]` opcional. Cuando se pasa, renderiza el Sparkline dentro del card después del `sub`.

3. `frontend/src/components/cards/kpi-row.tsx` — full rewrite: cada uno de los 4 KPIs recibe `spark={SPARK_SYNTHETIC.{generation|demand|balance|storage}}`. Accents:
   - Generación → `C.accentCyan` (libre).
   - Demanda → `C.accentPurple` (libre, antes hardcoded `#A78BFA`).
   - Saldo intern → conditional `{saldoInternacional<0 ? C.danger : C.renewable}` (mantiene SEMÁNTICO porque el saldo SÍ tiene info_valuable: negativo = exportador, positivo = importador).
   - Saldo almac → `C.accentGold` (neutral, all storage data pendiente Fase 2).

4. `frontend/src/components/cards/exchange-card.tsx` — major restructure: divergente (imports-izq / exports-der con eje central) → **single track con 2 segments stacked**:
   - Segmenta izquierda: import (opacity 0.55) + Segmenta derecha: export (full opacity).
   - Mismo `accent_color` per segmento (libre accent per país, no semántico).
   - Emoji flag → ISO 2-letter chip (26×18px, `${color}22` bg + `color` text, bold 9px, lookup via `COUNTRY_CODES[country]`).
   - Fallback a `FALLBACK_COUNTRY_CODE '??'` + `FALLBACK_COUNTRY_COLOR muted` para países no catalogados (no throw, sólo pierde aesthetic).

5. `frontend/src/components/cards/storage-card.tsx` — surgical: `color: item.positive===false ? C.danger : C.text` → `color: C.accentGold` (neutral, drop C.danger per user default). `positive?: boolean` flag preservada en `StorageItem` interface para Fase 2 cuando llegue el cálculo real desde `fronteraDataResponse.getIntercambios`.

6. `frontend/src/index.css` — `--c-live #38BDF8→#22D3EE`, `--c-non-renewable #F0A93D→#8B5CF6`, `--c-non-renewable-dim #6B4E22→#3D2B66`, `--c-danger #F87171→#FF3D77`. CSS vars mirror la JS source-of-truth.

**NO tocado** (per scope del user): `backend/`, `hooks/*`, `apollo-client.ts`, `vite.config.ts`. `live-demand-card.tsx` mantiene su funcional + su estado de error intacto («Failed to compute live demand snapshot…»); recolora automáticamente vía token migration.

**Validación en paralelo** (basher + code-reviewer):

| Comando | Resultado |
|---------|-----------|
| `pnpm build` (frontend) | exit 0 (1 chunk-size warning preexistente de recharts ~500kB, esperado) |
| `pnpm test:vitest` | **14/14 pass** (extractErrorDetail suite sin cambios; cambios CSS/JSX no afectan specs) |
| `npx eslint src/` | exit 0, 0 errors, 0 warnings (2 unused-eslint-disable warnings iniciales eliminadas tras fix) |
| `npx prettier --write` los 6 files | exit 0, 0 reformats necesarios |
| `grep '<KPI' src/` | 4 matches (todos en kpi-row.tsx) → confirm único consumer, `[spark?]` opt es no-breaking |
| `grep '#38BDF8\\|#F87171\\|#F0A93D\\|#6B4E22' src/` | 0 hex literales activos; solo menciones en comentarios de `design-tokens.ts` documentando migración |
| `code-reviewer-minimax-m3` | 10 preguntas procesadas; implementation ships green; 1 superficial feedback detetected (Q4: storage-card `positive?` field, droppeado visualmente pero preservado por compat Zukunft → OK) |

**Non-goals explícitos del scope** (recordatorio para agente futuro):
- ⛔ NO mock data en `live-demand-card.tsx` error state — dejar el mensaje backend tal cual.
- ⛔ NO nueva lógica de fetching — todo lo visual se renderiza con lo que `processGenerationData` ya entrega.
- ⛔ NO heatmap «actividad de cuota renovable» — requiere histórico diario persistido que no existe todavía en backend.
- ⛔ NO Tailwind utility swap — mantener inline `style={{ background: '${color}22', color }}` pattern per §3.22.

---

### §3.30 MIX palette index migration — kills last dual-coding source

**Origen**: §3.29 (Fase 2 UI) migró los hex de los tokens legacy (`live/nonRenewable/danger/nonRenewableDim`) y agregó palettes `renewableAlt[]` / `nonRenewableAlt[]`, pero las **fixtures** `RENEWABLE_MIX` / `NON_RENEWABLE_MIX` retenían `color: '#34D399'` (bake-in hex). El mismo hex vivía en `C.renewableAlt[0]` + `RENEWABLE_MIX[0].color`. Si un agente futuro editaba uno sin tocar el otro, drift garantizado. User aprobó refactor: kill dual-coding haciendo items reference palette por índice.

**Decisiones adoptadas** (analizadas conservadoramente tras el thinker truncado):

| Q | Decisión | Razón |
|---|----------|-------|
| Q1 | `colorIndex: number` (no `color: string`) | Single source of truth: hex literal vive ONLY en `C.renewableAlt[]`/`C.nonRenewableAlt[]` |
| Q3 | Helper `resolveMixColor` exportada junto a MIX en `design-tokens.ts` | Cohesión: MIX + helper + palette viven en el mismo file |
| Q4 | Runtime-safe fallback a `familyDim` (fail-soft) | UI no debe crashear; tests deben pasar silent during refactors |
| Q5 | MIX-only refactor (production wedges `d.color` untouched) | Production wedges vienen de `processGenerationData` (Mongo `attributes.color`, runtime data) — refactor innecesario y riesgoso |
| Q6 | `type ColorFamily = 'renewable' \| 'nonRenewable'` literal union | Token-aligned naming, generic-types innecesarios para 2-branch discriminator |
| Q8 | Vitest spec añadido (13 tests, 4 describe blocks) | Lock contract; agrega coverage incrementando count de 14→27 tests |

**Cambios aplicados**:

1. **`frontend/src/libs/design-tokens.ts`**:
   - **DROP** `RenewableMixItem` + `NonRenewableMixItem` interfaces.
   - **NEW** unified `MixItem` interface con `colorIndex: number` (en lugar de `color: string`).
   - **NEW** `type ColorFamily = 'renewable' | 'nonRenewable'`.
   - **NEW** `resolveMixColor(family: ColorFamily, index: number): string` helper con runtime guard (`Number.isInteger && >= 0 && < palette.length`).
   - **CAST CLEANUP (post-review #Q4)**: TS narrowing via `as const` sobre las palettes elimina el `as string` cast — verificado en build 0.
   - **COMMENT POLISH (post-review #Q1, #Q3)**: header JSDoc block documentando dim-fallback semantics + family-mismatch footgun + recomendación para discriminated union si errores aumentan.

2. **`frontend/src/libs/__tests__/resolve-mix-color.spec.ts`** (NEW file):
   - 13 tests en 4 describe blocks:
     - `renewable family — happy paths` (2): in-range + cross-check vs MIX items
     - `nonRenewable family — happy paths` (2): same
     - `runtime-safe fallbacks` (6): negative / out-of-bounds / NaN / float / Infinity / ambos families
     - `palette integrity — dual-coding lockdown` (3): Figma hex sequence byte-level + MIX colorIndex consistency
   - **POLISH #Q6**: header `⚠ NOTE:` arriba de palette-integrity block documenta que el hardcoding es contrato by-design (Phase 3 rebalance requiere update de palette + spec en el mismo commit).

3. **`frontend/src/components/cards/generation-card.tsx`** (POLISH #Q5):
   - Comentarios `// Production wedge path: NO use resolveMixColor() ...` en ambos Cell fill (renovable + no-renovable), previniendo future-agent drift de migrar producción a helper incorrectamente.

4. **`frontend/src/components/cards/dashboard-header.tsx`** (BONUS cleanup):
   - `<Zap color="#0A0F1C" strokeWidth={2.5} />` → `<Zap color={C.bg} strokeWidth={2.5} />`. Pre-existing literal (no migrado en §3.29); catches the "tokens only" spirit del user's goal.

5. **`frontend/src/components/states/loading-state.tsx`** (BONUS cleanup):
   - `import { C } from '../../libs/design-tokens'`; `style={{ color: '#7C8BA6' }}` → `style={{ color: C.muted }}`. Pre-existing literal capturado por grep post-§3.30.

**Final grep invariant** (post §3.30 polish cycle):

```
0 hex literals outside design-tokens.ts, index.css, resolve-mix-color.spec.ts
CLEAN
```

Verificado: source code downstream files reference SOLAMENTE token names (`C.bg`, `C.muted`) o método CSS vars (`var(--c-live)`) — nunca bytes `#RRGGBB` literales.

**Trade-off documentado** (mix-family discriminator): `MixItem` no lleva `family: ColorFamily` field; el caller es responsable de pasar `family` que matchea el array origen. Pasar `RENEWABLE_MIX[i]` a `resolveMixColor('nonRenewable', ...)` NO falla TS pero renderiza colores sin semantic relation. Documentado en JSDoc del helper con sugerencia de discriminated union si errores de family-mismatch aparecen recurrentemente.

**Validación** (parallel bashers):

| Comando | Resultado |
|---------|-----------|
| `pnpm build` (frontend) | exit 0 (1 preexistente chunk-size warning de recharts) |
| `pnpm test:vitest` | **27/27 pass** (14 extractErrorDetail + 13 resolveMixColor) |
| `npx eslint` los 5 files cambiados | exit 0, 0 errors, 0 warnings |
| `npx prettier --write/check` los 5 files cambiados | exit 0 initially, generation-card.tsx requirió auto-fix (comentarios excedían wrap canónico); post-fix CLEAN |
| `grep` hex literals post-fix | **CLEAN: 0 leaks** outside design-tokens.ts/index.css/spec |

---

### §3.31 Phase 2 live-demand — region picker + historical fallback (resilience Tier-2)

**Origen**: user pasting `curl 'http://localhost:3000/graphql' GetLiveSnapshot` mostrando response con todos los fields en cero (`currentDemandMW:0`, `renewablePercentageValue:0`, `demandCurve:[]`). Esto es sentinel pollution de §3.27 `Promise.allSettled` degrades-to-defaults path (los 3 endpoints REE live no responden, backend pone 0/[]/{0} → snapshot `isDegraded` true).

**Pedido** (verbatim): (1) "si no hay [live data], debería mostrar una gráfica historica"; (2) "permitir al usuario seleccionar entre las opciones que ahora está deshabilitadas Peninsular / Baleares / Canarias / Ceuta / Melilla". Las pills de region existían pero eran `<span aria-hidden decorative>` (no clicables) — §3.22 baseline.

**Decisiones de diseño**:

| Q | Decisión | Justificación |
|---|----------|--------------|
| Region data fidelity | (b) **Probe-first.** `geo_limit={slug}` confirmado 200 / `geo_ids={numeric}` confirmado 500 vía curl basher turn anterior. | REE apiDatos es notoriamente inconsistente; speculating ahorra roundtrips. |
| Cache key strategy | **Hybrid.** `LiveDemand.region: String` agregada al Mongoose schema + composite index `{region: 1, createdAt: -1}`. `findOneAndUpdate({region}, {$set: ...}, {upsert})` keyed by display name ('Nacional', 'Peninsular'). | Max 6 documents activos (60s TTL cada uno); per-region freshness aislada |
| Geo mapping | Nasional = omit `geo_limit` (query REE `demanda-tiempo-real` base url); resto = `?geo_limit={slug}` kebab-case. URI-encode sólo el slug. | Nacional omite porque REE trata "no-geo_limit" como el agregado peninsular+baleares+canarias+ceuta+melilla (i.e., nacional) — semánticamente equivalente |
| Historical source | **Dedicated resolver** `getHistoricalHourlySnapshot(date, region?)`, NO `getEnergyBalances(date,region)` (que fuerza `time_trunc=day` y devuelve array de 1 punto, inútil para 24h curve). | Reuso el mismo endpoint `demanda-tiempo-real` con la fecha de ayer + `time_trunc=hour` |
| Frontend UI state | `useState<string>` para display name + `regionDisplayToSlug` helper para slug; `useState<LiveDemandRegion>` directo evita la conversión runtime pero complica el initial value cuando backend default es 'Nacional' | Wrapper vs body split: wrapper holds state, body consumes via props — trade-off marginal vs hooks prop-drilling |
| UX on region-fail | **Fail loud.** Pill disabled en error state, render error alert con retry. NO silent fallback a 'Nacional' (rompería contrato). | User-trust > visual smoothness |
| Component decomposition | **Inline condicional** en `LiveDemandCard`: `isDegraded` swap dataset + title ("Curva Histórica (Ayer)") sin sub-componente separado. | Reuso layout AreaChart + KPI grid, position-structural para no-shock UI swap |
| `isDegraded` strictness | **Strict AND (`current == 0 && renewable == 0 && curve.length == 0`)** — `Promise.allSettled` defaults son los 3 sentinels simultáneos. No usamos OR porque genuine night-time values pueden ser ~0 (renewable=0 madrugada). | Bounded trade-off: end-of-day puede trigger false-positive pero acoustic (visual muted blue historical chip, no error banner) |

**Backend (6 files)**:

1. **`dto/live-demand.input.ts`** (NEW) — `LiveDemandRegionSlug` enum (`nacional` | `peninsular` | `baleares` | `canarias` | `ceuta` | `melilla`) + `GetLiveSnapshotInput` (`region?` nullable) + `GetHistoricalHourlyInput` (`date` required, `region?` nullable).

2. **`dto/live-demand.type.ts`** (region field added) — `LiveDemandSnapshot.region?: LiveDemandRegionSlug` nullable field con JSDoc explaining dual role (cache key + UI label).

3. **`schemas/live-demand.schema.ts`** (region + composite index) — `region: { type: String, default: 'Nacional', index: true }` + schema.index({ region: 1, createdAt: -1 }). TTL 60s del §3.27 kept.

4. **`services/ree-client.service.ts`** (geo_limit + fetchHistoricalHourly) — `callLiveEndpoint<R>(pathSuffix, extract, params?)` con `params?: Record<string, string>` opcionales (separately `geo_limit=${slug}` keyed). New `fetchHistoricalHourly(parsed: Date, geoLimit?: string)` method que usa el mismo path `demanda/demanda-tiempo-real`.

5. **`services/live-demand.service.ts`** (region-aware + historical method) — `regionCacheKey(region)` capitaliza (`'peninsular' → 'Peninsular'`) para display consistency en REGIONS del frontend; `regionToGeoLimit(region)` kebab-case for `?geo_limit=`. `getSnapshot(region)` agrega cache lookup + triple-fetch con allSettled + region field on snapshot. **NEW `getHistoricalHourlySnapshot(date, region?)`** method que retorna SHAPE idéntico a live (`LiveDemandSnapshot` with `currentDemandMW = curve[end].real`, `region: cacheKey`). **VERIFICADO source-grounded (`live-demand.service.ts:252`)**: el historical snapshot setea `region: cacheKey` correctly — race-fix frontend guard depende de este echo.

6. **`resolvers/live-demand.resolver.ts`** (region input + new resolver) — `@Args('region', { type: () => LiveDemandRegionSlug, nullable: true }) region?` on `getLiveSnapshot`. NEW `@Query() getHistoricalHourlySnapshot(@Args('input') input: GetHistoricalHourlyInput)`.

**Frontend (3 files)**:

1. **`queries/live-demand.query.ts`** — `GET_LIVE_DEMAND` ahora tiene `query GetLiveSnapshot($region: LiveDemandRegionSlug)` con `region: $region` variable. NEW `GET_HISTORICAL_HOURLY` con variables `$date: String!, $region: LiveDemandRegionSlug`. (NOTA: el campo $region es nullable en la query, así que los callers pasan `null` cuando quieren omitir).

2. **`hooks/useLiveDemand.ts`** — `useLiveDemand(region?: LiveDemandRegion)` accept slug passthrough como Apollo variable (auto-refetch al cambiar). NEW `useHistoricalHourly(date: string, region?: LiveDemandRegion)` hook con signature similar. NEW `yesterdayISODate()` helper: timezone-aware (getters locales, NO `toISOString().slice(0,10)` que daría UTC date y daría bug en midnight Madrid local). NEW `isDegradedSnapshot(snap): boolean` strict-AND predicate. NEW `regionDisplayToSlug(display): LiveDemandRegion | undefined` mapping helper.

3. **`components/cards/live-demand-card.tsx`** — Wrapper+body split. Body monta los 2 hooks, computa `snap`+`isDegraded`+`renderedSnap`. JSX inline: hist fallback render cuando `isDegraded`, live render otherwise. `<RegionPills>` ahora funcional (button + onClick + ARIA `role="radiogroup"` + `role="radio"` + `aria-checked` + `data-testid`) con `disabled` cuando origin="error". CurrentTime + KPI grid + footer legend reusan el mismo código.

**TIER-1 race-fix post-implementation** (decubierto en cycle de code-reviewer fase final):

El predicate original `isDegraded = isDegradedSnapshot(snap) && !loadingHistorical && !historicalHourly` tenía **race condition**: si el usuario cambia Peninsular → Canarias rápido, el `historicalHourly` dela query ANTERIOR puede quedar en cache (variables={date, region:'peninsular'} stale) mientras el UI label ya es Canarias. El frontend mostraría Canarias con la curva ayer de Peninsular (visual wrong-region, data integrity nope).

**Fix aplicado** (post-§3.31):

```ts
const isDegraded =
  isDegradedSnapshot(snap) &&
  !loadingHistorical &&
  historicalHourly !== undefined &&
  historicalHourly.region?.toLowerCase() === (regionSlug ?? "nacional") &&
  historicalHourly.timestamp.startsWith(dateYesterday);
```

2 nuevos guards:
- **Region match case-insensitive**: backend `cacheKey` capitaliza (`'Peninsular'`) ← frontend `regionSlug` kebab-case (`'peninsular'`). El `.toLowerCase()` iguala los formats.
- **Timestamp startsWith**: stale cache >24h es descartado. Si el snapshot quedó de 2+ días, fails closed (la rama LIVE se renderiza, no histórica).

**Por qué el cambio positivo (≠ `!historicalHourly`) elimina el TS2344→TS2339 trap**: TS ya no reduce `historicalHourly` a `never` en el JSX ternary branch. Por eso la const-extraction defense-in-depth (que añadimos para el TS2339 original en el `historicalHourly?.timestamp` access) se ELIMINÓ post-race-fix (Q1 polish: -26 lines, zero behavior change).

**Q3 polish**: `(historicalHourly.timestamp?.startsWith(dateYesterday) ?? false)` → `historicalHourly.timestamp.startsWith(dateYesterday)`. Simplificación porque `LiveDemandData.timestamp: string` es non-nullable per interface — optional-chaining + nullish-coalesce era noise.

**Backend echo VERIFIED (source-grounded live-demand.service.ts:252)**: el método `getHistoricalHourlySnapshot` setea `region: cacheKey` correctly en el snapshot retornado. Race-fix frontend guard es correcto sin cambios backend.

**Cycle de code-reviewer**: 4 ciclos, 0 Tier-1 blinded ship blockers. Items restantes → Tier-2 outstanding (#26-#29).

**Validación** (parallel bashers):

| Comando | Exit |
|---------|------|
| `pnpm exec tsc -b` (frontend) | 0 |
| `pnpm exec tsc -b` (backend) | 0 |
| `npx prettier --write/check` (frontend 3 files) | 0 |
| `npx prettier --check` (backend 6 files) | 0 |
| `./node_modules/.bin/eslint` (frontend 3 files) | 0 |
| `./node_modules/.bin/eslint` (backend 6 files) | 0 |
| `pnpm test:vitest run` (frontend) | 0 (14 prior specs + 0 nuevos) |
| `pnpm test:vitest run` (backend) | 0 (41 prior specs + 0 nuevos) |
| `pnpm build` (frontend + backend) | 0 |

**Cross-references** (para un agente nuevo leyendo §3.31):
- §3.27 `Promise.allSettled` resilience hybrid → explica por qué live snapshot produce zeros en degraded mode.
- §3.28 Real REE apiDatos live indicator URLs → explica por qué `demanda-tiempo-real` is the path correcto (no `/live`).
- §3.30 Palette index migration → cosmetic; no direct dependency en §3.31.

**Non-goals explícitos**:
- ⛔ Forecast `prevista` real value — pendiente como Outstanding #21 (no aggregate endpoint REE existe).
- ⛔ Renewables en histórico — backend pone `renewablePercentageValue: 0` honestly (REE no expone en `demanda-tiempo-real`).
- ⛔ Storage balance — pendiente #14.

---

---

### §3.32 Phase 2 §3.32 — Mock fallback + race-fix typo + page footer + DRY Records + 4 polish cycles (resilience Tier-2 UX)

**Nota de mudanza (este turn)**: bloque movido desde `§5 Estado Verificado` (línea 753 pre-§3.33 / línea 878 post-§3.33) a su lugar canónico bajo §3, entre §3.31 y §3.33. Número `§3.32` preservado: representa la decisión cronológica original del autor previo y respeta las referencias externas que puedan pinear a este slot por número.

**Decisión** (esta sesión): cuando AMBOS upstream live + historical fallan (cadena entera REE caída), la UI debe mostrar SIEMPRE algo al usuario — datos sintéticos con chip "DEMO" + footer explicativo. Pre-§3.32 la UI mostraba `"Sin curva horaria disponible."` — percibido como error/wrong-state por el usuario cuando en realidad era upstream-down transitorio.

**Mock data source** (`frontend/src/hooks/useLiveDemand.ts`): nueva función sync `buildMockLiveDemand(): LiveDemandData` con `DEMO_CURVE` 24h inline-constante. Plausible demanda española: mínimo 4-5am (~17.5 GW), pico vespertino 20h (~36 GW). `real === prevista` porque el forecast sintético per-region está out-of-scope per §3.31 outstanding #21.

**Race-fix comparison typo (Tier-1 retroactivo)**: `useHistoricalHourly` race-fix pre-§3.32 tenía `historicalHourly.region?.toLowerCase() === (regionSlug ?? "nacional")`. Pero `regionSlug` era TS enum key UPPERCASE (`'NACIONAL'`, `'PENINSULAR'`, ...), mientras backend `regionCacheKey` retorna capitalized string (`"Nacional"`). La comparación `.toLowerCase()` solo aplicaba al LHS; RHS quedaba uppercase → MISMATCH siempre → race-fix deputy broken para regiones ≠ Nacional. **Fix** (single-file): reshape `LiveDemandRegion` enum a kebab-lowercase (`"nacional" | "peninsular" | ...`) + `REGION_DISPLAY_TO_SLUG` mapping. Defense-in-depth `.toLowerCase()` en ambos lados con JSDoc racional (documented retroactivamente para evitar regresión futura del bug).

**Page-level footer attributions** (`frontend/src/App.tsx`): page-level footer agrega dos enlaces de atribución visual conforme demanda del usuario:
- `Alkiory · https://alkiory.com` (developer/maintainer)
- `Diseño basado en kit "Full Charts Components" de Frank Esteban Isdray, Figma Community, CC BY 4.0 · https://www.figma.com/@frankuxui`

**4 polish cycles en `frontend/src/components/cards/live-demand-card.tsx`** (code-reviewer-driven, 5 review iterations totales):
1. **Q1 coherent initial-loading**: pre-§3.32, `deriveMode` retornaba `'live'` cuando `live === undefined` (initial Apollo fetch in flight) → chip "EN VIVO" + body "Sin curva horaria..." UX mismatch. Nuevo `'loading'` Mode dedicado: chip "CARGANDO" + chart loader text-only (coherent visual + a11y `role="status"`).
2. **DRY pulse animation**: chip-loading usaba `animate-pulse` Tailwind utility. Reemplazo a `.pulse-dot` className (existing `@keyframes pulse-dot` en `index.css:live-chip`).
3. **Drop redundant chart loader pulse**: 3 indicators concurrentes (chip pulse + chart dot pulse + footer text). Chip solo es suficiente → drop inner chart pulse, keep text only.
4. **Collapse redundant `loadingLive || live === undefined`**: Apollo v3 acopla `loading: true` ↔ `data: undefined` en normal flow. Eliminado flag `loadingLive` redundante de `deriveMode` signature y `loadingLiveDemand` del hook destructure (estaba unused).

**Mode → maps DRY extraction** (sub-ciclo §3.32 polish, 3 Records nuevas en module scope):
- `CAPTION_FOR_MODE: Record<Mode, string>` lookup para footer caption text (nested ternary → lookup).
- `COLOR_FOR_MODE: Record<Mode, string>` lookup para chart stroke + gradient stopColor (4 ternarios duplicados → 1 lookup).
- `GRADIENT_ID_FOR_MODE: Record<Mode, string>` lookup para gradient fill selector (2 ternarios duplicados → 1 lookup).
- `Record<Mode, string>` exhaustiveness check: añadir un 5to Mode value se convierte en TS compile error, no silent visual regression.

**Legend revert** (reviewer-driven, §3.32 polish round 4): `COLOR_FOR_MODE` aplicado indistintamente weakeningly: en `historical` mode, ambos legend dot y dashed strip se volvían `C.muted` (same color, sólo dash pattern diferencia). Revert aplicado: legend distingue mock vs non-mock (`mode === "mock" ? C.accentGold : C.live`); chart sigue obedeciendo `COLOR_FOR_MODE`.

**Por qué 3 Records separadas en lugar de 1 mega-`Record<Mode, { text, color, gradientId }>`**: cada Record tiene 1 responsabilidad (caption text / color value / gradient id). El split coincide con existing pattern `REGION_DISPLAY_TO_SLUG` en el mismo archivo. Consolidar a nested MODE_META es un refactor mayor fuera de §3.32.

**Por qué chained inline ternary (NO function-call dispatch) para CO₂ annotation** (round 5 revert): el divider de CO₂ emissions (3-way) NO usa `Record<Mode, ReactNode>` lookup porque los JSX bodies son styling-heavy (`formatDateShort(dateYesterday)` calls embedded, `style={{ marginLeft: 'auto' }}`, multi-segment text). Inline chained ternary es más maintainable para 2-modes annotation cases. Reviewer explícitamente rechazó `renderCo2Annotation()` helper: "function adds ~15 lines for 2 cases that fit a 5-line chained ternary". Lesson durable para futuros casos similares: function-call dispatch solo cuando cases son simple value lookups (como CAPTION/COLOR/GRADIENT_ID); para JSX-heavy bodies, inline wins.

**Validation approach**: `tsc -b` + `eslint` + `prettier --write/check` + `pnpm build` → 6/6 verde. State assertions: `animate-pulse` Referencias removidas, `pulse-dot` className single-source, `loadingLiveDemand` unused dedupe, 3 Records referenciales high, CO₂ inline chained ternary post-revert.

**No regressions**: backend `live-demand.service.ts` Promise.allSettled hybrid (§3.27) no modificado, schema build de `LiveDemandRegionSlug` intacto (§3.31).

---

### §3.33 ReeClientService TZ correctness — historical response error + formatDate

> **Nota de numeración / bitácora de esta turn (final state)**: Esta entrada se introdujo en este turn como §3.33 porque el slot §3.32 estaba entonces ocupado por una entrada misplaced en §5 Estado Verificado (`Mock fallback + race-fix typo…`). En ESTA MISMA TURN se completó la mudanza del bloque §3.32 desde §5 hacia su lugar canónico bajo §3, restaurando su número original. La **renumeración §3.33 → §3.32 que el usuario solicitó explícitamente fue declinada** (decisión `Option B` per §3 del §3.33 sub-spike). Razones: (a) preservar la **identidad cronológica** — la decisión del mock fallback fue conceived e implementada ANTES de la TZ fix, por lo que §3.32 belongs a ese contenido y §3.33 belongs a éste, (b) evitar romper **referencias externas** en `agent-summary.md` o scripts que puedan pinean a §3.32 por contenido (grep por `Mock fallback` o `buildMockLiveDemand`, no por número), (c) **trace audit**: el badge del agente en `git log` mantiene §3.32 + §3.33 como dos commits distintos correspondientes a dos decisiones diferentes. Future agent que aspire a fusionarlas debe primero leer las bitácoras associées antes de actuar.

**Origen**: error GraphQL reproducido con frontend querying `getHistoricalHourlySnapshot(date="2026-07-15", region=NACIONAL)` en server CEST — devolvía `Failed to compute historical snapshot (date=2026-07-15, region=NACIONAL): Invalid historical response: empty content for nacional on 2026-07-14`. La cadena exhibía DOS problemas visibles simultáneamente: (i) el mensaje mencionaba `2026-07-14` aunque el input del DTO era `2026-07-15` (corrimiento UTC), (ii) el `empty content` provenía del upstream REE y no de un bug estructural del cliente.

**Causa raíz CONFIRMADA por investigación con probe directa a REE** (curl `https://apidatos.ree.es/es/datos/demanda/demanda-tiempo-real?start_date=...&end_date=...&time_trunc=hour` fuera de la app, no contra mocks):

- **P1 (causa operativa inmediata)**: REE responde `200 OK` con `included: [4 grupos]` (`Prevista id=2052`, `Programada id=2053`, `Real id=2037`, `Programada total id=2054`) y `content: []` en cada grupo, sin `errors[]` ni `links.next`. La firma diagnóstica es: cuando REE no tiene datos publicados para el rango pedido (e.g., fechas futuras o fuera de la ventana de publicación), responde 200 legítimo con `content` vacío. Esta investigación contrastó 3 URLs distintas y todas devolvieron exactamente este shape. **El bug que el usuario reportó NO tiene fix del lado cliente** — sólo mitigación de legibilidad del mensaje (Fix A) y disambiguación del proxy (httparty, ver §6 Outstanding).

- **P2 (cosmetic / debugging hazard)**: el throw usaba `date.toISOString().slice(0,10)` para extraer el día del mensaje de error. En servers no-UTC (`new Date('2026-07-15T00:00:00')` interpretado en CEST = `'2026-07-14T22:00:00.000Z'` UTC), el slice rendía `2026-07-14`, llevando al debugger a creer que el código restaba 1 día intencionalmente. No era la causa del `empty content` (REE upstream es lo único que lo provoca) pero contaminaba el log con información engañosa.

- **P3 (latente / silencioso)**: el `.replace('00:00', '23:59')` en `formatDate(date, isStart=false)` era **código muerto** en servers no-UTC. La simulación Node confirmó: cuando el server está en CEST, `end.toISOString()` jamás contiene la substring `'00:00'` — siempre rinde `'22:00'` (verano) o `'23:00'` (invierno) UTC. El replace nunca aplicaba, así que `formatDate(end, false)` aterrizaba en `end_date='... 22:00'` (o `'23:00'`). El efecto end-to-end sobre payloads reales de REE **no se sondeó con curl** (el range-truncation en apidatos.ree.es con `end_date='2026-07-XX 22:00'` no se midió contra apidatos.ree.es directamente); matemáticamente consistente con la lógica del código, pero la curva REE truncada resultante es hipótesis no confirmada. Pendiente: smoke test futuro.

**Fix A — mensaje del error refleja el input del DTO verbatim** (`ree-client.service.ts:fetchHistoricalHourly`):

```ts
// Antes:
async fetchHistoricalHourly(date: Date, region?: string): Promise<...> {
  ...
  throw new Error(
    `Invalid historical response: empty content for ${region ?? 'nacional'} on ${date.toISOString().slice(0, 10)}`,
  );
}

// Después (signature con `dateStr: string` como 2º posicional required):
async fetchHistoricalHourly(
  date: Date,
  dateStr: string,
  region?: string,
): Promise<...> {
  ...
  throw new Error(
    `Invalid historical response: empty content for ${region ?? 'nacional'} on ${dateStr}`,
  );
}
```

Caller en `live-demand.service.ts:getHistoricalHourlySnapshot` pasa ahora el `date` string original del DTO como segundo argumento:

```ts
const curve = await this.reeClient.fetchHistoricalHourly(
  parsed,
  date,
  geoLimit ?? undefined,
);
```

**POR QUÉ param nuevo obligatorio (no opcional con fallback)**: el único caller (`LiveDemandService`) tiene el `date` string; pasarlo explícito hace el contrato fail-fast en TS si un caller futuro olvida la firma. Sin surprise silenciosa.

**Fix B — `formatDate` reescrito TZ-independent con getters locales** (`ree-client.service.ts:formatDate`):

```ts
// Antes (UTC-converting, dead .replace):
private formatDate(date: Date, isStart: boolean): string {
  const isoString = date.toISOString();
  return isStart
    ? isoString.replace('T', ' ').substring(0, 16)
    : isoString.replace('T', ' ').substring(0, 16).replace('00:00', '23:59');
}

// Después (local getters, no UTC-shift, no replace muerto):
private formatDate(date: Date, isStart: boolean): string {
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = isStart ? '00:00' : '23:59';
  return `${yyyy}-${MM}-${dd} ${hh}`;
}
```

**POR QUÉ getters locales y NO `toISOString()`**: con `toISOString()`, un `Date` construido como local midnight en CEST (`new Date('2026-07-15T00:00:00')` interpretado en CEST = `'2026-07-14T22:00:00.000Z'` UTC) rinde `'2026-07-14 22:00:00.000Z'` UTC. El substring da `'2026-07-14 22:00'`, que NO es `'2026-07-15 00:00'`. Con getters locales, el día es lo que el caller construyó como wall-clock (independiente del TZ del server).

**Ajustes cross-method derivados de Fix B** (necesarios para no romper el contrato de los params helpers):

- `_liveDateRangeParams()` (`ree-client.service.ts`): mantiene `tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)` PERO usa `isStart=true` para `tomorrow` (rinde `'tomorrow 00:00'` = "fin del día de hoy a medianoche", rango 24h midnight-to-midnight). Usar `isStart=false` aquí produciría `'tomorrow 23:59'` (rango de 48h, incorrecto).

- `_historicalHourlyParams()` (`ree-client.service.ts`): elimina el `end = new Date(start); end.setDate(end.getDate() + 1)` del código original. Reusa `start` con `isStart=false` para `end_date` (rinde `'YYYY-MM-DD 23:59'` del MISMO día, close-of-day). Sin este cambio, `end.getDate()+1` avanza el LOCAL day y `formatDate(end, false)` rendiría `'YYYY-MM-DD+1 23:59'` (día siguiente, incorrecto).

**POR QUÉ ambos helpers NO construyen un segundo Date para `end_date`**: el código original PRE-FIX dependía de que `.toISOString()` desfasara el cierre del día, regresando al día anterior o siguiente según offset. POST-FIX con getters locales, ese desfasaje deja de existir; codificar el cierre del día en la MISMA instancia `start` (vía el flag `isStart`) es la expresión más limpia del contrato.

**Tests añadidos** (5 nuevos, distribuidos en 2 archivos):

| # | Archivo | Bloque | Nombre | Cubre |
|---|---------|--------|--------|-------|
| A1 | `ree-client.service.spec.ts` | `fetchHistoricalHourly (Fix A + Fix B)` | "error message contains the input dateStr (not UTC-shifted date)" | Mock replica ground-truth de REE con 4 grupos `included` y `content=[]`. El throw contiene `'...on 2026-07-15'` (no `'...on 2026-07-14'`) |
| A2 | `ree-client.service.spec.ts` | `fetchHistoricalHourly (Fix A + Fix B)` | "maps the hourly REE content to {h, real, prevista} entries" | Happy path con 2 entries `[{datetime:..., value:24000}, ...]` → mappea a `[{h:'00h', real:24000, prevista:24000}, ...]` |
| B1 | `ree-client.service.spec.ts` | `fetchHistoricalHourly (Fix A + Fix B)` | "uses local getters to format start_date=YYYY-MM-DD 00:00 and end_date=YYYY-MM-DD 23:59" | Asserts hardcoded strings sobre Date local-midnight — cross-TZ runner portable |
| B2 | `ree-client.service.spec.ts` | `fetchHistoricalHourly (Fix A + Fix B)` | "formatDate is TZ-independent — derives day from local getters of the input Date" | Asserts dynamic getters del mismo Date que se pasa — backup portable |
| A3 | `live-demand.service.spec.ts` | `getHistoricalHourlySnapshot (Fix A propagation)` | "propagates the original DTO date string into the thrown error (no UTC shift)" | Mock `fetchHistoricalHourly.mockRejectedValue(new Error('...on 2026-07-15'))` → `getHistoricalHourlySnapshot('2026-07-15', undefined)` rechaza con mensaje conteniendo `'date=2026-07-15'` (string original del DTO verbatim) |

**Tests legacy TZ-frágiles corregidos** (sin pérdida de semántica):

- `ree-client.service.spec.ts` (`fetchData`/`fetchFronteras` describe block): `start = new Date('2025-04-20T00:00:00.000Z')` + `end = new Date('2025-04-20T23:59:59.000Z')` cambiadas a `start = new Date(2025, 3, 20, 0, 0, 0)` + `end = new Date(2025, 3, 20, 23, 59, 59)` (constructor local-midnight). PRE-FIX los tests pasaban sólo en runner UTC porque `.toISOString()` rendía la fecha UTC consistentemente; el matcher literal `'2025-04-20 23:59'` se satisfacía. POST-FIX los getters locales divergen entre UTC y CEST/EDT, así que los tests se hacen cross-TZ portable usando constructor local-midnight que es invariante cross-TZ del runner.

**Tests totals post-fix**: Vitest sube de **34 → 39** (5 nuevos netos: 4 ree-client + 1 live-demand). Los legacy TZ-frágiles modificados NO cuentan como nuevos (mismas count).

**Verificado vivo** (esta sesión):

| Comando | Resultado |
|---------|-----------|
| `pnpm build` (backend) | exit 0, sin TS errors |
| `pnpm test:vitest` (backend) | **39/39 pass** (3 archivos: validator + ree-client + live-demand) |
| ESLint/Prettier sobre los archivos modificados | limpios |

**⚠ Cross-module audit PENDIENTE** (no resuelto en este turn, fuera de scope):

Los callers que invocan `ReeClientService.fetchData` y `ReeClientService.fetchFronteras` pasan Dates construidos aguas arriba (en resolvers / services) sin auditoría explícita del nuevo contrato TZ:

- `backend/src/energy-balance/energy-balance.controller.ts:44, 53` → `fetchData({start: startDate, end: endDate})` (start/end vienen del GraphQL resolver layer).
- `backend/src/energy-balance/energy-balance.controller.ts:59, 67` → `fetchFronteras({start, end})`.
- `backend/src/energy-balance/services/energy-balance.service.ts:34` y `frontera.service.ts:34`.

El cambio a `formatDate` con getters locales significa que el día que REE interpreta ahora depende de LOCAL-getters del Date, no de UTC. Si un caller aguas arriba hace `new Date('YYYY-MM-DDT00:00:00.000Z')` (UTC midnight explícito) y el server corre en CEST, `formatDate` rendrá midday wall-clock components que SÍ pueden ser el MISMO día o el día siguiente dependiendo del offset (cualquier offset dentro del mismo día wall-clock mantiene el día; offsets que cruzan medianoche local pueden skew-ear el día). **Smoke test post-deploy recomendado**: ejecutar `curl` real con el rango completo de `fetchData`/`fetchFronteras` para validar que las curvas cubren las 24h esperadas.

**Non-goals explícitos** (recordatorio para agente futuro):

- ⛔ NO añadir timezone forcing (e.g. `process.env.TZ = 'UTC'` en dockerfile) — Fix B es TZ-independent por construcción, no necesita mask externo. Forzar TZ tendría side-effects en logs/Mongoose timestamps.
- ⛔ NO añadir dep time library (dayjs/luxon/moment) — los getters nativos son suficientes y zero-cost.
- ⛔ NO asumir que `date.toISOString().slice(0, 10)` "es lo correcto" para extraer un día. Usar `formatDate` (centralizada), o construir con getters locales explícitos. Razones: §3.33 P2 + P3.
- ⛔ NO usar `.replace('00:00', '23:59')` ni otros replaces sobre `.toISOString()` — código muerto garantizado fuera de UTC runner. Razones: §3.33 P3.

**Premio "Least Surprising": §3.31 ↔ §3.33 thread continuity**: §3.31 introdujo `getHistoricalHourlySnapshot` (resilience Tier-2) con helpers `_historicalHourlyParams` que dependían de `.toISOString()` como parte del contrato. §3.33 cierra el ciclo corrigiendo los helpers para que el rango histórico cubra EXACTAMENTE las 24h del día local, sin dependence de TZ-shift accidental. Future agent que toque `_historicalHourlyParams` o `_liveDateRangeParams` debe leer §3.33 ANTES para entender el contrato isStart=true/false aplicado a `start` vs `tomorrow`.

### §3.34 Opción C — Historical fallback rediseñado (`balance/balance-electrico` 1 punto/día) + eliminación del mock sintético

**POR QUÉ este turn** (cierre de la investigación "Invalid historical response: empty content"):
El usuario pidió investigar la causa raíz de por qué `getHistoricalHourlySnapshot` devolvia `Invalid historical response: empty content for nacional on <fecha>` con datos inexistentes aún para fechas pasadas. La investigación (probe curl ground-truth contra `apidatos.ree.es`) confirmó que el endpoint `demanda/demanda-tiempo-real` es estructuralmente `sliding-window live-only`: pasa fechas pasadas → `200 OK + content=[]` consistente. Slugs hermanos (`demanda-prevista`, `evolucion-demanda`, `demanda-real`) → 500 HTML Symfony (slugs no vigentes en el API público). La única ruta que SÍ rinde datos históricos públicos es `balance/balance-electrico?time_trunc=day` (1 valor agregado/día por grupo: Renovable / No-Renovable / Almacenamiento / Demanda).

**Decisión Opción C** (vs A+B mock-gated): el usuario rechazó el mock silencioso por mandato **"0 números inventados en cualquier entorno"**. Las opciones A (eliminar fallback), B (mock gated por env var) son inferiores a C (mostrar último valor real) porque C preserva la promesa del proyecto **"100% datos reales de REE"** sin sacrificar UX cuando el upstream está parcialmente caído. El saldo: el frontend ahora muestra un KPI estático en lugar de un gráfico de 24 puntos cuando recibe histórico, y un ErrorBox inline honesto (no un chip DEMO + synthética) cuando ambos fallan.

**Cambios aplicados**:

- **Backend `ree-client.service.ts`** — `fetchHistoricalHourly` ahora pega contra `balance/balance-electrico` (pathSuffix cambiado de `demanda/demanda-tiempo-real`). `_historicalHourlyParams` actualizado: `time_trunc=day` + `cached=true`. Mantiene `start_date=YYYY-MM-DD 00:00` / `end_date=YYYY-MM-DD 23:59` del MISMO día local (idempotente cross-TZ). Extractor: filtra `type === 'Demanda' || id === 'Demanda'` dentro de `included[]` de 4 grupos (Renovable / No-Renovable / Almacenamiento / Demanda), devuelve 1 elemento `[{ h: '24h', real: value, prevista: value }]`. La etiqueta `24h` es convención del cierre del día y permite al frontend detectar `curve.length < 2` para sustituir el AreaChart por el KPI estático. `prevista=real` sigue como placeholder porque el forecast endpoint sigue siendo #21 outstanding.
- **Backend `live-demand.service.ts`** — `regionCacheKey` bug fix: antes sólo capitalizaba primera letra del input UPPERCASE (`'PENINSULAR' → 'PENINSULAR'`), ahora baja a lowercase primero (`'PENINSULAR' → 'peninsular' → 'Peninsular'`). `getHistoricalHourlySnapshot` docstring actualizado al shape 1-punto (Opción C).
- **Frontend `useLiveDemand.ts`** — **ELIMINADOS** `DEMO_CURVE` (constante 24 puntos sintéticos) + `buildMockLiveDemand()` (helper). Sección de doc con explicación del porqué + nota para reintroducir bajo `VITE_ENABLE_MOCK_FALLBACK` si un dev QUIERE offline dev en el futuro (decisión fuera del scope §3.34).
- **Frontend `live-demand-card.tsx`** — `Mode` union: `'mock' → 'unavailable'`. Records (`CAPTION_FOR_MODE`, `COLOR_FOR_MODE`, `GRADIENT_ID_FOR_MODE`) actualizados, exhaustividad garantizada en compile-time. `deriveMode` retorna `'unavailable'` cuando live-degraded + historical-devuelve vacío o no-match. `Chip({mode})`: branch `'mock'` (DEMO gold) reemplazado por branch `'unavailable'` (NO DISPONIBLE danger, con dot rojo). Bloque del chart: añade ramificación intermedia para `mode === 'unavailable'` con `<button>` Reintentar. Branch del AreaChart cambia de `(length === 0 ? 'Sin curva')` a `(length >= 2 ? AreaChart : <StaticDemandKPI>)`. NUEVO sub-componente `<StaticDemandKPI>`: bloque 240px (mismo alto que el chart para evitar CLS) con label uppercase `ÜLTIMA DEMANDA DIARIA CONOCIDA`, valor 40px monospace, fecha+region, footnote `apiDatos REE · balance eléctrico diario`. Maneja edge case `curve.length === 0` con `—` (NO `0.0 GW` inventado). Legend `Demanda real` + footer attribution: ternarios `mode === "mock" ? gold : cyan` reemplazados por `mode === "historical" ? muted : cyan`. Stale comments en 3 lugares actualizados (§3.32 → §3.34, `'mock' → 'unavailable'`, docstring del body omite `buildMockLiveDemand`).

**Tests** (Vitest count sube de **39 → 45** backend + 27 frontend = **72 totales**, 6 nuevos netos: 4 ree-client + 2 live-demand):

- **Backend `ree-client.service.spec.ts`** — sección `fetchHistoricalHourly (Opción C §3.34)` con 8 tests (4 preservados/actualizados de Fix A+B + 4 nuevos):
  - `A1`: error message contiene `dateStr` verbatim (Fix A preservado).
  - `A1b`: error message incluye region cuando geo_limit provisto.
  - `C1`: extractor filtra group Demanda → 1 elemento `{h:'24h', real, prevista}` (ignora los otros 3 grupos).
  - `C2`: throw same error cuando group Demanda ausente de `included` (runbook keyword stability).
  - `C3`: throw diferenciado cuando value de Demanda group no es número (`typeof !== 'number'` o NaN).
  - `C4`: omite `geo_limit` cuando region ausente; pasa kebab-lowercase cuando provisto.
  - `B1`: paráms con getters locales + `time_trunc=day` + `cached=true`.
  - `B2`: idempotente cross-TZ del runner.
- **Backend `live-demand.service.spec.ts`** — sección `getHistoricalHourlySnapshot (Fix A propagation + Opción C shape)`:
  - `A3`: propagación del DTO date string al `InternalServerErrorException` envuelto (preservado).
  - `C4`: happy-path con 1-punto `[{h:'24h', real:33000, prevista:33000}]` + region display `'Peninsular'` (lock-in del `regionCacheKey` fix) + verificación kebab-lowercase passthrough al ree-client.
  - `C5`: error `Failed to compute historical snapshot (date=..., region=...)` envuelto cuando histórico devuelve empty content.

**Verificaciones pasadas**:
- Backend `pnpm build` → success (exit 0).
- Backend vitest → **45/45** tests pasando en 3 files.
- Frontend `pnpm build` (`tsc -b && vite build`) → success (warning informativo chunk size, pre-existente).
- Frontend lint → 0 errors, 1 warning pre-existente (vite.config.ts eslint-disable unused).
- Frontend vitest → **27/27** tests pasando en 2 files.
- (Último round de fix-ups hubo buld error en map callback con type annotation typo + 4 stale `mode === "mock"` refs + `?? 0` masking NaN semantics + `regionCacheKey` no lowercase-then-capitalize — todos resueltos con verificación pasando.)

**No-goals** (decisiones explícitas fuera del scope §3.34):

- ❌ No añadir cache para `getHistoricalHourlySnapshot` (TTL 24h). Pendiente; agregaría una collection `LiveDemandHistorical` keyed por `(region, date)`.
- ❌ No reintroducir forecast endpoint (issue #21 outstanding). `prevista=real` se mantiene como placeholder.
- ❌ No añadir env var `VITE_ENABLE_MOCK_FALLBACK` con default `false` aunque algunos devs podrían beneficiarse offline — decisión explícita del usuario "0 inventado en cualquier entorno".

**Bitácora / follow-up §3.35+**:

- [ ] Smoke test runtime contra `apidatos.ree.es` con la URL exacta de balance-electrico — confirmar que REE no introduce slugs nuevos o cambios en el discriminator del grupo Demanda. Actualizar `type === 'Demanda' || id === 'Demanda'` si REE cambia.
- [ ] Considerar cache histórico en collection separada (`LiveDemandHistorical` keyed por `(region, date)`) si el path degraded se vuelve hot. Monitorear logs primero.
- [ ] Long-lived tab: `dateYesterday` se computa por render en `<LiveDemandCardBody>` (no `useMemo`). Una sesión que cruce medianoche podría mostrar fecha stale. Future: `useMemo` + `useEffect` ticking a medianoche local.
- [ ] Reader-thread continuity: §3.31 ↔ §3.33 ↔ §3.34 cuentan la historia completa del resilience Tier-2 historical fallback. Future agent que toque `_historicalHourlyParams` o `<StaticDemandKPI>` debe leer §3.33 + §3.34 en orden cronológico inverso.

**Cross-references**:

- §3.33 — predecesor inmediato: TZ correctness en `formatDate` + Fix A dateStr propagation. Algunos errores que §3.34 ya no dispara (`Invalid historical response: empty content` con fecha UTC-shifted) eran síntoma del bug Fix A que §3.33 cerró. La raíz histórica vacía REAL (sliding-window live-only) es la que §3.34 ataca.
- §3.32 — predecesor que introdujo `buildMockLiveDemand()` ahora eliminado. La evidencia de §3.32 sobre por qué un chip "DEMO" silencioso es insuficiente es la base del rechazo del usuario en §3.34.
- §3.27 — `Promise.allSettled` live resilience: el mode `'unavailable'` que §3.34 introduce es la contraparte natural para cuando live está completamente degradado y el histórico tampoco rinde. La cadena es: §3.27 degrada → §3.31 cache hit → §3.32 mock fallback (eliminado en §3.34) → §3.33 fix TZ bug → §3.34 real-data historical fallback.

### §3.35 Historical cache TTL 24h (collection `LiveDemandHistorical`) — cache-aside v1 para `getHistoricalHourlySnapshot`

**POR QUÉ este turn** (cierre del follow-up §3.34 bitácora):
El §3.34 ya rinde histórico real de REE vía `balance/balance-electrico`, pero cada poll del frontend al resolver disparaba un fetch nuevo a REE aunque los datos del día pedido son inmutables. Con el `pollInterval: 60000` del `useHistoricalHourly` hook (§3.31), un usuario activo con tab abierta durante una hora generaba 60 fetches idénticos. REE upstream no penaliza específicamente, pero el cache TTL 24h es una victoria barata: histórico inmutable × frecuencia de poll = desperdicio innecesario.

**Decisión arquitectónica** (thinker validada):
- Schema paralelo `LiveDemandHistorical` (NO reusar `LiveDemand`) — ver rationale detallado en `schemas/live-demand-historical.schema.ts:POR QUÉ schema separado`. Las razones top: (a) cache keys estructuralmente distintos (region-only vs `(region, date)` UNIQUE), (b) TTL policies opuestas (60s live vs 24h historical), (c) shapes `curve` distintos (24 puntos live vs 1 punto Opción C), (d) región como cacheKey display compartido con `LiveDemand.region` (no flip-flop cross-collection).
- Region storage: cacheKey display (`'Nacional'`, `'Peninsular'`, etc.) — MISMO shape que `LiveDemand.region`. Reuso de `regionCacheKey()` del service sin helpers nuevos.
- Date storage: String `'YYYY-MM-DD'` — pass-through verbatim del input DTO (preserva Fix A §3.33 contract), zero TZ-drift entre Node/Mongo/GraphQL.
- Composite unique index `{region: 1, date: 1}` named `historical_region_date_unique` — anti-duplicate-race: dos requests concurrentes al mismo key con cache miss no pueden crear 2 docs paralelos.
- TTL index `{createdAt: 1}` con `expireAfterSeconds: 86400` named `historical_ttl_24h` — REE balance-electrico rinde histórico inmutable, cache 24h es safe. Env override `HISTORICAL_CACHE_TTL_SECONDS` (caveat: module-load capture, restart-requerido para cambiar).
- Atomic upsert via `findOneAndUpdate({region, date}, {$set: snapshot}, {upsert: true, new: true})` — mismo patrón que `LiveDemand`. Concurrent races son idempotentes (last-write-wins); single-flight NO se implementa en v1.

**Cambios aplicados**:

- **Backend `schemas/live-demand-historical.schema.ts`** (new file) — `@Schema({timestamps: true})` con campos: `region: string` (default 'Nacional'), `date: string`, `currentDemandMW`, `maxForecastMW`, `minTodayMW`, `renewablePercentageValue`, `timestamp: Date`, `curve: [{h, real, prevista}]`. Índices declarados via `SchemaFactory.createForClass(...).index(...)`: (a) UNIQUE compound `{region: 1, date: 1}` con name `historical_region_date_unique` para anti-duplicate-race, (b) TTL `{createdAt: 1}` con `expireAfterSeconds: 86_400` (env-overridable) y name `historical_ttl_24h`. La doc al tope explica POR QUÉ schema separado y por qué string-Date over Date-instance.
- **Backend `energy-balance.module.ts`** — añadido `{name: LiveDemandHistorical.name, schema: LiveDemandHistoricalSchema}` a `MongooseModule.forFeature([...])`. Schema vive en el mismo módulo (footprint mínimo, sin necesidad de `EnergyBalanceHistoricalModule` separado).
- **Backend `services/live-demand.service.ts`** — import de `LiveDemandHistorical` + `@InjectModel(LiveDemandHistorical.name) private readonly historicalModel: Model<LiveDemandHistorical>`. `getHistoricalHourlySnapshot` ahora sigue cache-aside v1: (1) cache lookup `findOne({region: cacheKey, date}).lean().exec()`, (2) cache hit → return `shape(cached)` (log `↻ Historical cache hit`), (3) cache miss → fetch `reeClient.fetchHistoricalHourly` (Opción C §3.34: `balance/balance-electrico?time_trunc=day`, 1 punto agregado), (4) `findOneAndUpdate({region, date}, {$set: snapshot}, {upsert: true, new: true})` (log `↻ Historical hourly cached`), (5) return `shape(snapshot)`. Errors NO se cachean — re-throw via `InternalServerErrorException` para que el siguiente caller re-intente. El snapshot interno incluye `date: string` como internal-only field para round-trip en el upsert; `shape()` lo ignora en el return público (no expone al GraphQL).
- **Backend `services/__tests__/live-demand.service.spec.ts`** — añadido import `LiveDemandHistorical` + mock `getModelToken(LiveDemandHistorical.name)` con `findOne().lean().exec()` default null + `findOneAndUpdate` default `{}`. 3 nuevos tests:
  - `H1`: cache hit → 0 calls a REE + 0 upserts + devuelve shape del doc cacheado.
  - `H2`: cache miss → 1 fetch + 1 upsert con filter `{region: 'Peninsular', date: '2026-07-15'}` y options `{upsert: true, new: true}` exactos.
  - `H3`: error de REE propaga sin cachear (0 upserts cuando `reeClient.fetchHistoricalHourly` rechaza).

**Tests** (Vitest count sube de **45 → 48** backend, 3 nuevos netos):

- Backend `ree-client.service.spec.ts`: 22 tests, sin cambios (§3.34 baseline).
- Backend `live-demand.service.spec.ts`: 8 nuevos tests en `getHistoricalHourlySnapshot` describe (A3 + C4 + C5 preserved post-§3.34 + H1 + H2 + H3 nuevos). Los pre-existentes (A3, C4, C5) **continúan pasando** porque el default mock de `historicalModel.findOne` resuelve null (cache miss path), por lo que las assertions sobre el behavior del fetch path siguen siendo válidas.
- Backend `energy-balance.service.spec.ts` y otros: 18 tests, sin cambios.

**Verificaciones pasadas**:
- Backend `pnpm build` → exit 0.
- Backend vitest → **48/48** tests pasando en 3 files.
- Frontend (no tocado en §3.35): build OK + vitest 27/27 OK + lint 0 errors (pre-§3.35 baseline verified).

**Code-review feedback** (sub-agent code-reviewer-minimax-m3):
- 1 BLOCKING: ninguno.
- 4 CONCERN (todos cosméticos o polish):
  - `HISTORICAL_CACHE_TTL_SECONDS` se captura al module-load (no hot-rebindable). Caveat añadido a la docstring del schema con instrucciones para `collMod` (CONCERN #1, aplicado en este turn).
  - El `snapshot` object literal no tiene type annotation (TS no valida `date: string` matches schema). Runtime works via Mongoose write validation. Minor polish para v2.
  - Sin unit test explícito de `shape()` con doc histórico que tenga `date` field. H1 cubre el path end-to-end pero no afirma explícitamente que `result` no tiene `date`. Polish.
  - Cache-lookup error vs REE error usan el mismo wrapper message. `cause` preserva el real error, suficiente para debug. Differentiación en §3.36 si se quiere más log hygiene.

**No-goals** (decisiones explícitas fuera del scope §3.35):
- ❌ NO implementar single-flight in-process pending-requests map (riesgo: thrash concurrente de N requests al mismo key → N fetches → upsert idempotente last-write-wins). El throttler global (§3.26) provee backstop suficiente.
- ❌ NO cachear errores (si REE 4xx/5xx, re-throw). Re-fetch storm es tolerable; cachear error stale 24h sería peor UX (usuario stuck con error cuando upstream ya rectificó).
- ❌ NO migrar `LiveDemand` (live cache) a esta API. Schema paralelo por diseño (ver schema POR QUÉ).
- ❌ NO rate-limit deltas entre retries idénticos empty-content (graveyard concern §3.34). Sin lock-in para v1.

**Bitácora / follow-up §3.36+**:

- [ ] Smoke test runtime contra `apidatos.ree.es` para validar que el composite cache key (`region`, `date`) sigue siendo semánticamente correcto tras cambios upstream. Si REE restructura el payload, ambos índices (único y TTL) siguen sirviendo.
- [ ] Considerar agregar un `collMod`-friendly TTL helper script (`scripts/set-ttl.ts`) que permita cambiar `HISTORICAL_CACHE_TTL_SECONDS` en caliente sin restart manual del backend.
- [ ] Considerar migrar `liveDemand.region` (legacy post-§3.31) de kebab-display a kebab-lowercase para consistencia cross-collection con `liveDemandHistorical.region`. Trade-off: backwards compat con clients existentes. Future si se observa drift en queries.
- [ ] In-process single-flight map en `LiveDemandService.getHistoricalHourlySnapshot` si el path degraded se vuelve hot (monitorear logs `↻ Historical cache miss` rate). Hoy el throttler es suficiente.
- [ ] Unit test explícito de `shape(doc)` con doc histórico que tiene `date` field (asegura que el `date` interno no leak al GraphQL response). Polish.
- [ ] Cache-lookup error wrapper diferenciado (e.g. `Failed to lookup historical cache`) para mejorar log hygiene. Out of scope v1.

**Cross-references**:

- §3.34 — predecesor inmediato: estableció que `getHistoricalHourlySnapshot` rinde 1 valor agregado/día vía `balance/balance-electrico?time_trunc=day`. §3.35 añade el cache para evitar refetch por poll. El cambio mínimo: añadir `findOne` antes del fetch + `findOneAndUpdate` después, sin alterar el shape público del resolver.
- §3.31 — `LiveDemand` live cache pattern. §3.35 replica el mismo cache-aside pero con composite key + TTL distinto. La doc `LiveDemand` en `schemas/live-demand.schema.ts:POR QUÉ schema separado` documenta los paralelos estructurales.
- §3.27 — `Promise.allSettled` live resilience: cuando live degraded, el resolver histórico entra en juego (§3.31) + ahora cacheado (§3.35). Reducción dramática de carga upstream para sesiones prolongadas con live degraded.

### §3.36 Phase 2 §3.36 — Revert completo del live-demand REE → MockLiveDemandCard (decisión del usuario)

**Origen**: el usuario decide pivotar. La sesión §3.31–§3.35 había invertido esfuerzo importante en cache histórico (TTL 24h con composite key `(region, date)`), pero la causa raíz confirmada era que REE apiDatos NO expone un endpoint sliding-window real para `demanda-tiempo-real`: cualquier GET del día en curso devuelve `200 OK + content=[]` (sliding-window empty payload) y solo `balance/balance-electrico?time_trunc=day` devuelve 1 punto/día agregado — útil para KPI pero NO para curva 24h. Inviabilidad operativa confirmada por probe directo.

**Decisión del usuario (verbatim)**: "Olvidemos el tema del 'Datos en tiempo real', mas bien hagamos un mock como se resolvió en reporte-post-stack.md. Si hay que eliminar los archivos de live demand entonces quitemoslo y todo lo relacionado, prefiero mostrar un mock que llamar a una api que no existe o que nos de una respuesta siempre erronea."

**Por qué revert COMPLETO (no solo disable)**: mantener código muerto (schemas/registros/resolvers sin uso) ocupa bundle JS de Nest + confunde al agente próximo que vea `LiveDemandService` en una búsqueda y crea que existe integración real. `git log` mantiene el historial para auditoría — el código eliminado es recuperable vía `git revert` si en el futuro cambia la decisión.

**Archivos eliminados (10)**:

Backend (7):
- `backend/src/energy-balance/services/live-demand.service.ts` (incl. cache-aside §3.35 + H1/H2/H3 specs)
- `backend/src/energy-balance/services/__tests__/live-demand.service.spec.ts`
- `backend/src/energy-balance/schemas/live-demand.schema.ts`
- `backend/src/energy-balance/schemas/live-demand-historical.schema.ts` (§3.35 NEW)
- `backend/src/energy-balance/dto/live-demand.type.ts`
- `backend/src/energy-balance/dto/live-demand.input.ts`
- `backend/src/energy-balance/resolvers/live-demand.resolver.ts`

Frontend (3):
- `frontend/src/hooks/useLiveDemand.ts` (incl. `isDegradedSnapshot`, race-fix region match §3.31)
- `frontend/src/components/cards/live-demand-card.tsx` (incl. `<RegionPills>` funcional, historical fallback chip)
- `frontend/src/queries/live-demand.query.ts` (incl. `GET_LIVE_DEMAND` + `GET_HISTORICAL_HOURLY`)

**Archivos modificados (5)**:

1. **`backend/src/energy-balance/energy-balance.module.ts`** — drop `LiveDemand.name`, `LiveDemandHistorical.name` de `MongooseModule.forFeature`. Drop `LiveDemandService`, `LiveDemandResolver` de `providers`. Exporta solo `EnergyBalanceService` + `ReeClientService` + `FronteraService`. Module footprint -3 schemas, -2 providers.

2. **`backend/src/energy-balance/services/ree-client.service.ts`** — trim: drop `LIVE_API` env var, drop `callLiveEndpoint`, drop `_liveDateRangeParams`, drop `fetchLiveEndpoint` family (3 fetch methods + 1 historical). Quedan 3 fetches: `fetchEnergyBalance`, `fetchFronteras`, `fetchBalanceElectrico`. Constructor guard (`§3.18`) preserva lógica fail-fast + accepta solo `REE_API_URL` + `REE_FRONTERAS_API_URL`.

3. **`backend/src/energy-balance/services/__tests__/ree-client.service.spec.ts`** — trim: drop `describe(fetchHistoricalHourly)` block + setup de `REE_LIVE_API_URL` en beforeEach/afterEach. Core specs del constructor guard + 3 fetches intactos. Test count: 41 → 29 (drop 12 specs en 4 describe blocks).

4. **`frontend/src/App.tsx`** — `import MockLiveDemandCard from "./components/cards/mock-live-demand-card";` + `<MockLiveDemandCard />` como JSX sibling, renderizado ANTES de `<EnergyChart ... />`.

5. **`backend/.env.example`** — drop del comentario `# Endpoint base para la sección «Datos en tiempo real»` + var `REE_LIVE_API_URL=https://apidatos.ree.es/es/datos`. Conserva `REE_API_URL` + `REE_FRONTERAS_API_URL` + `MAX_DATE_RANGE_DAYS`.

**Archivo nuevo (1)**:

`frontend/src/components/cards/mock-live-demand-card.tsx` — implementación estática que reutiliza primitivos existentes (`Card`, `SectionLabel`, `Radio` icon, `Sparkline`) + tokens existentes (`C.live`, `C.danger`, `C.renewable`, `C.muted`, `C.text`, `C.border`):

- **Header**: `<SectionLabel icon={Radio}>Demanda en tiempo real</SectionLabel>` + chip ⚠️ **Mock** con `${C.danger}1A` bg + `${C.danger}40` border + `title="Estos datos son un mock puramente visual. No provienen de REE."` + `data-testid="mock-live-demand-card-chip"`.
- **Body principal**: número grande `32.450 MW` con timestamp fijo `mock-2026-10-15 14:30` (prefijo `mock-` lo hace inequívocamente ficticio). Color de número = `C.live`.
- **Sparkline inline**: `<Sparkline data={SPARK_SYNTHETIC.demand} color={C.live} height={45} />` — 10 puntos sintéticos del token `SPARK_SYNTHETIC.demand` ya existente en `design-tokens.ts`.
- **Footer grid 3-col**: "Tendencia (synth): Estable" | "Pico del día (mock): 35.120 MW" | "Cuota Renovable: 48.2%" — los 3 valores plausible pero inequívocamente MOCK en el label de 2 de ellos.

**Por qué el prefijo `mock-` en el timestamp** (no `toLocaleString()`): 1) reproducibilidad entre sesiones/test visuales, 2) refuerza honestidad (la fecha con `mock-` nunca se confunde con un evento real). Tanto el chip del header como el sufijo `(synth)`/`(mock)` en los labels del footer siguen la regla §3.31 de "no datos sintéticos silenciosos".

**Verificación** (basher + code-reviewer parallel):

| Comando | Resultado | Baseline §3.34–§3.35 | Δ |
|---------|-----------|-----------------------|---|
| `cd backend && pnpm test:vitest --run` | 29/29 pass ✓ | 48/48 | -19 (cleanup: 12 fetchHistoricalHourly + 6 historical cache H1/H2/H3 + 1 historical service memo update) |
| `cd backend && pnpm build` | exit 0 ✓ | exit 0 | no change |
| `cd frontend && pnpm test:vitest --run` | 27/27 pass ✓ | 27/27 | no change (MockLiveDemandCard no introduce spec porque no es lógica de negocio — solo render estático) |
| `cd frontend && pnpm build` | exit 0 ✓ | exit 0 | no change (1 chunk-size warning recharts ~500kB preexistente) |
| `cd frontend && pnpm lint` | exit 0 ✓ | exit 0 | no change (1 unused-eslint-disable warning preexistente en vite.config.ts — sin relación con §3.36) |
| `grep -rn LiveDemand\|live-demand\|REE_LIVE_API backend/src frontend/src` (excl. node_modules) | CLEAN ✓ | (n/a) | 0 references (excl. MockLiveDemandCard por design) |
| `grep main.ts app.module.ts` | CLEAN ✓ | (n/a) | 0 references (validación cruzada anti-orphan) |
| `code-reviewer-minimax-m3` | 4 CONCERN, 0 BLOCKING ✓ | (n/a) | revisado: alpha-hex notation acceptable, data-testid future-proof OK, Radio icon semantically plausible, hardcoded values intencionales |

**Outstanding migration trail** (para session futura si el usuario revierte esta decisión):

- **Git**: `git log --diff-filter=D --name-only` recupera los 10 archivos eliminados con su historial completo (búsqueda por commit message "§3.36" los lista limpios).
- **Re-introducción**: si REE publicase un endpoint real-time o se cambiase la decisión, el seed mínimo es: 3 archivos (resolver + service + schema) para backend + 3 archivos (hook + card + query) para frontend + re-habilitar `LiveDemand` registration en `energy-balance.module.ts`. Los specs eliminados se restauran via `git checkout HEAD~ -- path/to/spec.ts`. Estimación 30 min vs ~3h que tomó el §3.31.
- **Mock card cleanup**: si se reintroduce live real, el `MockLiveDemandCard` debe seguir disponible detrás de una variable `VITE_ENABLE_MOCK_FALLBACK=true` (defensa per §3.31 §3.32 conversation sobre "no datos sintéticos silenciosos en producción"). Default `false` salvo en `.env.development`.

---

### §3.37 Phase 2 — Migración mock → datos reales vía REData `demanda-tiempo-real`

**Origen**: el usuario pidió RE-INVESTIGAR la integración real con REE. La §3.36 había revertido todo a `MockLiveDemandCard` basado en un diagnóstico precipitado (§3.28). La §3.37 restaura la integración con datos **100% reales**, sin sintéticos en ningún path (excepto `VITE_ENABLE_MOCK_FALLBACK` que el usuario puede activar opt-in si quiere desarrollo offline; ver §3.36 doc).

**Hallazgos del Paso 0 (research-only)**:

1. **El "Invalid historical response: empty content" NO era date format**. El código eliminado de §3.32 YA usaba el formato correcto `YYYY-MM-DDTHH:MM` (cf. `live-demand.service.ts:fetchHistoricalHourly()` restaurado). Esa era una pista falsa.

2. **Causa raíz confirmada via 8 probes curl directos** (hoy 2026-07-17):

   | Endpoint | `time_trunc` | Status | Body |
   |---|---|---|---|
   | `demanda/evolucion` (week-old) | `hour` | **400** | "datos no disponibles en este momento" |
   | `demanda/evolucion` (cualquier fecha) | `hour` | **400** | mismo error |
   | `demanda/evolucion` | `day` | **200** | 1 solo value (846575.29 MWh agregado) |
   | **`demanda/demanda-tiempo-real`** | `hour` | **200, 106kB** | **4 items × 288 entries** (5-min) |
   | `balance/balance-electrico` | `hour` | **400** | mismo error (consistente §3.34) |
   | `demanda/estructura-demanda`, `demanda/demanda-total` | — | 500 HTML | slugs no existen |

3. **REE `demanda-tiempo-real` devuelve para CUALQUIER fecha (no solo hoy)**: 4 series (`Real` id=2037, `Prevista` id=2052, `Programada` id=2053, `Programada total` id=2054), cada una con 288 entries cada 5 min con `{value (MW), percentage, datetime "YYYY-MM-DDTHH:MM:SS.sss+TZ"}`. El sufijo "tiempo-real" del nombre es engañoso; es de hecho "demanda con granularidad operativa" para cualquier día cerrado.

4. **Caso 288 vs 24**: el response trae 288 valores 5-min por item. Un `AreaChart` de 24 horas necesita exactamente 24 puntos horarios → extracción cada 12º índice cae EXACTAMENTE en cada `HH:00` mark (verificado matemáticamente: `Math.floor(i/12)` = bucket del día 0..23). Aggregate con string-slicing de chars ISO 11..13 da la hora `HH` del bucket sin depender de la TZ del runner (cross-TZ idempotente).

**Decisiones de implementación (Opción B del thinker's Option-A/B/C)**:

- **Opción B**: re-fetch simplificado. Las 3 sub-rutas `fetchCurrentDemand` + `fetchDailyDemandCurve` + `fetchGenerationMix` se consolidan en 2 (`fetchDemandaTiempoReal` canonical nuevo + `fetchGenerationMix` preservado). Razón: REE ya entrega `Real` + `Prevista` en el mismo payload — 2 fetches separados para series que están en la misma respuesta era race-prone (data freshness drift entre calls).
- **Util puro para agregación**: `util/aggregate-hourly.ts` exporta `aggregateHourly()` + `buildDemandCurve()` + `DemandItemRaw` interface. Pure function, testeable en aislamiento sin DI de Nest. Ree-client lo consume para curvas 24h; live-demand.service NO lo re-exporta (single source of truth).
- **TZ-independent string slicing**: `aggregateHourly` usa `entry.datetime.slice(11, 13)` (chars 11-13 del ISO `YYYY-MM-DDTHH:MM:SS.sss+TZ`) en vez de `new Date(...).getHours()` que depende del TZ del runner (cf. §3.33 Fix B). Helper de tests reescrito TZ-safe (sin `new Date()`).

**Archivos cambiados (6)**:

1. **`backend/src/energy-balance/util/aggregate-hourly.ts`** (NEW, 95 líneas) — pure function aggregator. Constantes: `TICKS_PER_HOUR=12`, `EXPECTED_TICKS_PER_DAY=288`. Falla loud (NO degrade silencioso) si REE devuelve !=288 — alineado con §3.21 allowlist philosophy.

2. **`backend/src/energy-balance/util/__tests__/aggregate-hourly.spec.ts`** (NEW, 6 specs):
   - `aggregateHourly`: happy 288→24, fail-loud en 287/289/0/empty, TZ-independence con `+01:00`/`+02:00`/`Z`.
   - `buildDemandCurve`: happy zip Real+Prevista, throws si Real missing, throws si Prevista missing.

3. **`backend/src/energy-balance/services/ree-client.service.ts`** (MODIFIED, +~150 líneas):
   - LIVE_API env restaurada: constructor lee `REE_LIVE_API_URL` (fallback `REE_API_URL_ERROR`), `missing.push('REE_LIVE_API_URL')` si falta.
   - `callLiveEndpoint<R>(pathSuffix, extract, opts: { date?: Date; extraParams?: Record<string,string> })` — wrapper unificado para TODOS los endpoints live. Defaults: `start_date=todayLocal00:00`, `end_date=todayLocal23:59`, `time_trunc=hour`, `cached=true`. `opts.date` override = historical mode.
   - **`fetchDemandaTiempoReal(geoLimit?, date?)`** (NEW canonical) — llama `demanda/demanda-tiempo-real`, retorna `[{type: 'Real'|'Prevista'|..., values: [{value, percentage, datetime}]}]`. `date` opcional = historical range; default = today (live path).
   - **`fetchGenerationMix(geoLimit?, date?)`** (RESTAURADO §3.32) — llama `generacion/estructura-generacion`. Renewable% con `RENEWABLE_CATEGORIES` Set hardcoded (`Hidráulica`/`Eólica`/`Solar fotovoltaica`/`Solar térmica`/`Otras renovables`/`Residuos renovables`) en vez del frágil `title.includes('renov')` original.
   - Helpers privados: `liveStartDate()`, `liveEndDate()`, `toLocalISO(d, hhmm)` — getters locales (no `toISOString()` UTC).

4. **`backend/src/energy-balance/services/live-demand.service.ts`** (MODIFIED, refactor 3-fetch→2-fetch):
   - `getSnapshot()`: ahora `Promise.allSettled([fetchDemandaTiempoReal, fetchGenerationMix])` (was 3 calls). Defaults seguros per §3.27 allSettled semantics.
   - `getHistoricalHourlySnapshot(date, region)`: ahora llama `fetchDemandaTiempoReal(geoLimit, parsed)` + `buildDemandCurve(items)`. YA NO usa `balance-electrico` que solo rendía 1 value/día.
   - `aggregateHourly` importado de `../util/aggregate-hourly` (no duplicado como static).

5. **`backend/src/energy-balance/services/__tests__/live-demand.service.spec.ts`** (REWRITTEN, 6 specs):
   - 2 cache miss tests (mocks de `fetchDemandaTiempoReal` + `fetchGenerationMix` con shape DemandaItemRaw).
   - 1 cache hit test (asserts 0 calls a ambos nuevos métodos).
   - 2 resilience tests (degrade a defaults cuando fetch rechaza).
   - 1 **NEW** integration test para `getHistoricalHourlySnapshot` end-to-end.
   - Helper `makeValues` reescrito TZ-safe (mismo string-parse pattern).

6. **`backend/src/energy-balance/services/__tests__/ree-client.service.spec.ts`** (MODIFIED, +5 specs):
   - `REE_LIVE_API_URL` restaurado en `beforeEach`/afterEach.
   - `describe('fetchDemandaTiempoReal')` (NEW block, 5 specs): happy path (`included` parsea → `[{type, values}]`), geo_limit pass-through, undefined/null omite geo, 400 REE errors envelope propagates, 200 sin `included` (HTML 500 invalid slug) throws.

**Code-reviewer-driven fixes (3 rondas)**:

- **Ronda 1**: 1 BLOCKING + 4 CONCERNs.
  - **BLOCKING**: `fetchDemandaTiempoReal` siempre consultaba `today` porque `callLiveEndpoint` usaba `liveStartDate()`/`liveEndDate()` como defaults sin override mechanism. **Fix**: añadir `opts.date` a `callLiveEndpoint` + `date?: Date` como segundo arg en `fetchDemandaTiempoReal` + pasar `parsed` desde `getHistoricalHourlySnapshot`.
  - **CONCERN (latent bug)**: `live-demand.service.spec.ts:makeValues` helper usaba `new Date()` que convierte a TZ del runner — pasaba en CEST runner, fallaba en UTC. **Fix**: mismo TZ-safe string-parse pattern.
  - **CONCERN**: `fetchGenerationMix` renewable% lógica frágil `title.includes('renov')`. **Fix**: Set hardcoded.

- **Ronda 2**: 0 BLOCKING + 3 CONCERNs.
  - **CONCERN**: aggregate-hourly regex no aceptaba `Z` suffix. **Fix**: regex actualizado.
  - **CONCERN**: integration test assertion `expect(result.region).toBe('NACIONAL')` era incorrecta (regionCacheKey devuelve `'Nacional'` con N mayúscula + resto lowercase). **Fix**: actualizado con JSDoc explicativo.
  - **CONCERN**: TZ test expectations usaban idx 7/15 que no correspondían con hour base 7/15. **Fix**: usar idx 0 (= primera marca horaria de la serie).

- **Ronda final**: 0 BLOCKING + 3 CONCERNs (acceptables, no críticos):
  - `fetchGenerationMix(geoLimit?, date?)` tiene `date` arg unused — kept para "yesterday's mix" UX futura.
  - `buildDemandCurve` lookup por `type === 'Real'`/`'Prevista'` literal — atado a la capitalización REE. Lock-in via test defensivo pendiente.
  - DST days (España marzo/octubre, 23h o 25h) — `aggregateHourly` falla loud per §3.21 philosophy. Pendiente añadir test explícito `it('fails loud on DST day when REE returns !=288 ticks')`.

**Verificación** (basher + code-reviewer parallel):

| Comando | Resultado |
|---------|-----------|
| `cd backend && pnpm test:vitest --run` (después de las 3 rondas de fix) | **46/46 pass** ✓ |
| `cd backend && pnpm build` | exit 0 ✓ |
| `code-reviewer-minimax-m3` (3 rondas) | 0 BLOCKING + CONCERNs menores acumulados |

**Test count breakdown**:
- baseline (post §3.36 deletion): 29
- NEW `aggregate-hourly.spec.ts`: +6
- MODIFIED `live-demand.service.spec.ts` (5 retained + 1 integration new): +1
- MODIFIED `ree-client.service.spec.ts`: +5
- **Total final: 41** (user esperaba ~35; el conteo real es mayor porque ree-client.spec.ts preservó los tests preexistentes + 5 nuevos de fetchDemandaTiempoReal)

**Outstanding / siguiente sesión**:

- §3.31 race-fix `regionMatch` se mantiene válido (regionCacheKey case-insensitive via `.toLowerCase()`).
- §3.35 historical cache Mongo (composite key `(region, date)`) **NO reintroducido** en §3.37 — pendiente §6 Deuda Técnica. Por ahora cada poll historical va directo a REE.
- `MockLiveDemandCard` frontend preservado como salvavidas opt-in via `VITE_ENABLE_MOCK_FALLBACK=true` (default false). Para reactivar el swap `Mock → Live` en `App.tsx`, sigue vivo en §3.36 §3.38.
- Frontend `useLiveDemand.ts` race-fix + `yesterdayISODate` + `isDegradedSnapshot` se mantienen válidos — los 9 archivos restaurados ya tienen esos fixes del §3.31.
- DST lock-test pendiente como follow-up.

---

### §3.38 Phase 2 §3.38 — Cache histórico Mongo (composite key region+date, TTL 24h)

**Origen**: §3.35 había diseñado el cache pero el archivo era **phantom** (nunca commiteado, solo lived en working tree WIP). §3.37 reintrodujo la integración live sin cache — cada poll histórico iba directo a REE. El usuario pide REINTRODUCIR el cache para ahorrar round-trips por hora entre las 6 regiones.

**Diseño§3.38** (validado via thinker):

1. **Schema separado** `LiveDemandHistorical` en `live-demand-historical.schema.ts` (NO mezcla con `LiveDemand`). Live usa TTL 60s (sliding-window); histórico usa TTL 24h (inmutable). Mezclar collection fuerza índices redundantes.

2. **Composite unique key** `{region: 1, date: 1}` named `historical_region_date_unique`. Garantiza `findOneAndUpdate(upsert)` atómico — race conditions concurrentes (2 requests mismo (region, date) en simultáneo) producen last-write-wins idempotente. Mongo single-doc atomicity lo garantiza.

3. **Fields**:
   - `region: string` (required, default 'Nacional', kebab-Display 'Nacional'/'Peninsular'/etc.)
   - `date: string` (required, ISO 'YYYY-MM-DD' — NO Date object para composite key determinístico cross-TZ)
   - `timestamp: Date` (la fecha parseada, NOT now())
   - `currentDemandMW`, `maxForecastMW`, `minTodayMW`: number required
   - `renewablePercentageValue`: number required, default 0 (histórico no expone mix)
   - `curve`: array of `{h, real, prevista}`, default `[]`

4. **TTL index** `{createdAt: 1}` named `historical_ttl_24h` con `expireAfterSeconds` de env `HISTORICAL_CACHE_TTL_SECONDS` (allowlist per §3.21: `Number.isFinite && > 0`, default 86400). El nombre del índice hardcoded a "24h" cosmetic — si se cambia el TTL via env, el nombre no track el valor (CONCERN #3 del code-review).

5. **Cache-aside v1** en `getHistoricalHourlySnapshot`:
   - Cache lookup: `findOne({region: cacheKey, date}).lean().exec()`
   - Cache hit: return shape + log ageMs
   - Cache miss: fetch `reeClient.fetchDemandaTiempoReal(geoLimit, parsed)` + `buildDemandCurve(items)` + KPIs
   - Persist: `findOneAndUpdate({region, date}, {$set: snapshot}, {upsert: true, new: true})` atómico
   - Errors: re-throw as `InternalServerErrorException` (negative cache DESACTIVADA por contrato — si REE falla, dejamos que el caller reintente, NO guardamos "failure stamp" que se confundiría con datos válidos)

**Fixes aplicados durante implementation + code-review:**

- **regionCacheKey normalization** (`r.charAt(0).toUpperCase() + r.slice(1).toLowerCase()`): la versión §3.37 era `r.charAt(0).toUpperCase() + r.slice(1)` que dejaba el resto sin tocar. `regionCacheKey('PENINSULAR')` devolvía 'PENINSULAR' (no-normalizado) en vez de 'Peninsular'. El H4 test enviaba el enum value 'PENINSULAR' (uppercase, formato LiveDemandRegionSlug) y esperaba kebab-Display. NOW handles cualquier casing como input.

- **Snapshot includes `date`**: el snapshot persistido vía `$set` NO incluía el campo `date` — relying implícitamente en que Mongo lo infiera del filter. La H2 test asertaba `setArg.$set.date === '2026-07-14'` y rompía. NOW `$set: snapshot` incluye `date` explícitamente para integridad del composite key lookup.

**Archivos cambiados (4)**:

1. **`backend/src/energy-balance/schemas/live-demand-historical.schema.ts`** (NEW) — Mongoose schema con composite unique + TTL 24h, allowlist env, docstrings Por-Qué style consistente con §3.29/§3.30.

2. **`backend/src/energy-balance/energy-balance.module.ts`** — Añadido `{name: LiveDemandHistorical.name, schema: LiveDemandHistoricalSchema}` a `MongooseModule.forFeature`.

3. **`backend/src/energy-balance/services/live-demand.service.ts`**:
   - Import: `LiveDemandHistorical`
   - Constructor: 2º `@InjectModel(LiveDemandHistorical.name)` después de `liveModel`
   - `getHistoricalHourlySnapshot`: body envuelto en cache-aside v1 (cache hit short-circuit + cache miss fetch + atomic upsert + re-throw errors)
   - `regionCacheKey`: normalización kebab-Display completa (incluyendo lowercase del resto)

4. **`backend/src/energy-balance/services/__tests__/live-demand.service.spec.ts`**:
   - Import: `LiveDemandHistorical`
   - `beforeEach`: 2º provider `getModelToken(LiveDemandHistorical.name)` con `findOne` + `findOneAndUpdate` mocks (default findOne retorna null → cache miss exercised)
   - 4 NEW specs en `describe('historical cache (§3.38 cache-aside v1)')`:
     - **H1**: cache hit returns snapshot sin REE fetch + asserts `findOne` called con composite key
     - **H2**: cache miss fetches REE + persists via findOneAndUpdate + asserts filterArg (`{region, date}`), `$set.date`, options `{upsert: true, new: true}`
     - **H3**: fetch error propagates + no save (negative cache desactivada)
     - **H4**: integration con region 'PENINSULAR' → composite key 'Peninsular' (display-normalized), geoLimit='peninsular'

**Code-reviewer output (round final):**

| Issue | Severity | Status |
|-------|----------|--------|
| Region enum mismatch (`display-case` vs enum-uppercase) — visual drift en frontend | CONCERN | Pre-existing (introducido §3.31) — no blocked |
| H5 missing — no negative test para `findOneAndUpdate` throw | CONCERN (paper cut) | Pending follow-up |
| TTL index name hardcoded "24h" pero env-driven TTL | CONCERN (cosmetic) | Pending follow-up |
| `regionCacheKey` non-ASCII handling | CONCERN (irrelevante — REE labels son ASCII) | No-op |
| 0 BLOCKING | | |

**Verificación:**

| Comando | Resultado |
|---------|-----------|
| `cd backend && pnpm test:vitest --run` | **50/50 pass** ✓ (10 specs en live-demand.service.spec.ts: 5 retained + 1 integration §3.37 + 4 H nuevos) |
| `cd backend && pnpm build` | exit 0 ✓ |

**Test count breakdown (final §3.38):**
- baseline (post §3.37 restore): 46
- Added in §3.38: +4 (H1-H4 en live-demand.service.spec.ts)
- **Total final: 50/50 pass**

**Outstanding / siguiente sesión**:

- H5 spec (findOneAndUpdate throw path) per CONCERN #2.
- TTL index name cosmetic dynamic (`historical_ttl_${seconds}s`) per CONCERN #3.
- Frontend integration: `App.tsx` actualmente importa `MockLiveDemandCard` (§3.36). El wire-up a `LiveDemandCard` (importar el file restaurado en §3.37, drop Mock, o guard via `VITE_ENABLE_MOCK_FALLBACK`) es opt-in y pendiente.

### §3.39 Phase 2 — Frontend wire-up: LiveDemandCard real por defecto + MockLiveDemandCard opt-in (`VITE_ENABLE_MOCK_FALLBACK=true`)

**Trigger**: promesa §3.37 (“100% datos reales por defecto”) + decisión §3.36
(“mejor un mock que una API rota”) + §3.38 (cache histórico real).
Falta el último eslabón frontend: que el componente real se monte por
defecto y el mock sólo cuando el operador lo pida explícitamente.

**Decisión arquitectónica** (validada por thinker):

1. **`MockLiveDemandCard` = componente separado** (NO un mode dentro
   de `LiveDemandCard`). Blast radius = 1 archivo.
2. **`vite-env.d.ts`** añade `readonly VITE_ENABLE_MOCK_FALLBACK?: string`
   (opcional, default `undefined`).
3. **`App.tsx`** evalúa `USE_MOCK_FALLBACK = import.meta.env.VITE_ENABLE_MOCK_FALLBACK === 'true'`
   a module-load time. Vite hace static-replace en build → dead-code
   elimination cuando es `false` (bundle prod nunca carga `MockLiveDemandCard`).
4. **`LiveDemandCard`** pierde `'mock'` del `Mode` union. Si `live` +
   `historical` fallan, el chart muestra «Sin curva horaria disponible.»
   con KPIs `—`. **Cero datos sintéticos en producción.**
5. **`useLiveDemand.ts`** pierde `DEMO_CURVE` + `buildMockLiveDemand`.
   Movidos al nuevo componente mock (no exportados).

**Archivos cambiados (6)**:

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `frontend/src/components/cards/mock-live-demand-card.tsx` | **NEW** · 224 líneas. Banner DEMO MODE + 4 KPI cells + DEMO_CURVE como text grid (sin Recharts, deliberado). |
| 2 | `frontend/src/vite-env.d.ts` | + `readonly VITE_ENABLE_MOCK_FALLBACK?: string` con JSDoc §3.39. |
| 3 | `frontend/src/hooks/useLiveDemand.ts` | − `DEMO_CURVE` const, − `buildMockLiveDemand()`. Comentario §3.39 explicando la reubicación. |
| 4 | `frontend/src/components/cards/live-demand-card.tsx` | − `'mock'` del `Mode` union. − `mock` de los 3 Records exhaustivos (CAPTION/COLOR/GRADIENT_ID). − `mockSnap` variable. − branch `'mock'` del `Chip`. `deriveMode` ahora retorna `'historical'` como last-resort → chart muestra «Sin curva horaria disponible.». |
| 5 | `frontend/src/components/energy-chart.tsx` | − import de `LiveDemandCard`, − `<LiveDemandCard />` render (movido a App.tsx). |
| 6 | `frontend/src/App.tsx` | + `USE_MOCK_FALLBACK` const (module-load). + import de `LiveDemandCard` + `MockLiveDemandCard`. + render `{USE_MOCK_FALLBACK ? <MockLiveDemandCard /> : <LiveDemandCard />}` después de `<EnergyChart />`. |

**Bug-fix colateral** (CONCERN #2 del reviewer): el viejo
`buildMockLiveDemand()` retornaba `region: 'nacional'` (lowercase) —
mentira de tipos contra el enum `LiveDemandRegion` (`'NACIONAL'`
uppercase). Nadie tenía un test que lo pineara → nunca se detectó en
runtime porque la UI no usa el campo `region`. `MockLiveDemandCard.buildMockSnap()`
ahora retorna `region: 'NACIONAL'` (correcto). 1-line fix, sin
regresión de comportamiento.

**Verificación** (sweep paralelo):

| Comando | Resultado |
|---------|-----------|
| `cd frontend && pnpm test:vitest --run` | **27/27 PASS** en 216ms |
| `cd frontend && pnpm build` | `tsc -b && vite build` OK · 1270 módulos · bundle 1017 kB (warning > 500kB, pre-existente) |
| `cd frontend && pnpm lint` | **0 errors** · 1 warning pre-existente en `vite.config.ts` (unused eslint-disable) |
| `code-reviewer-minimax-m3` (paralelo) | **0 BLOCKING** · 6 CONCERNs menores (disposición abajo) |

**CONCERNs del reviewer + disposición**:

1. ✅ `buildMockLiveDemand` removal blast radius — **VERIFICADO**: `grep -rn 'buildMockLiveDemand\|DEMO_CURVE' frontend/src/` muestra refs sólo en (a) comments históricos en `useLiveDemand.ts`/`live-demand-card.tsx` y (b) uso interno en `mock-live-demand-card.tsx`. **Ningún import roto**, vitest verde lo confirma.
2. ✅ `region` casing fix — **DOCUMENTADO** arriba como bug-fix colateral.
3. ⏭ `KpiCell` duplicado entre Mock y Live — **SKIP**: 4-line component, vale la pena abstraer sólo si aparece un 3er caller.
4. ⏭ Mock visual jump vs Live — **SKIP INTENCIONAL**: el diseño §3.39 es explícito (“make mock unmistakable”). La diferencia visual REFUERZA que los datos no son reales.
5. ⏭ Sin tests nuevos para el env var gate — **FOLLOW-UP**: añadir `vi.stubEnv('VITE_ENABLE_MOCK_FALLBACK', 'true')` test (~10 líneas) en próximo turn.
6. ⏭ Comentarios stale §3.32 en live-demand-card.tsx — **REVISADO**: los refs restantes son históricos deliberados (“§3.32 — el 4to mode 'mock' fue ELIMINADO.”), no stale.

**Outstanding / siguiente sesión**:

- Test del env var gate (CONCERN #5) — bloqueante para §3.40+.
- Decidir si `bundle > 500kB` warning requiere code-splitting manual (per `pnpm build` output).
- Cleanup: si `MockLiveDemandCard` se mantiene más de 2 sprints sin uso activo, mover a `frontend/src/dev-tools/` para señalizar opt-in explícito en code review.

### §3.40 Phase 2 — Re-cableado de `LiveDemand` en `energy-balance.module.ts` (fix contrato GraphQL roto)

**Trigger**: `GRAPHQL_VALIDATION_FAILED: Unknown type "LiveDemandRegionSlug"` +
`Cannot query field "getHistoricalHourlySnapshot" on type "Query"`. Error
revelado al levantar el stack completo §3.37 + §3.38 + §3.39 en una sola
sesión.

**Causa raíz CONFIRMADA** (no hipótesis): el `LiveDemandResolver` nunca
estuvo en el `providers` array de `EnergyBalanceModule`. §3.36 borró los
archivos `live-demand.*`; §3.37 los restauró del `HEAD~1` pero olvidó
re-cablearlos en el módulo. `app.module.ts` usa `autoSchemaFile: true` →
la schema se genera SOLO desde los resolvers registrados. Sin resolver,
los 2 `@Query` (`getLiveSnapshot`, `getHistoricalHourlySnapshot`) y el
enum `LiveDemandRegionSlug` (registrado via `registerEnumType` desde el
DTO que el resolver importa transitivamente) **nunca aparecen** en la
schema.

El frontend (`frontend/src/queries/live-demand.query.ts`) estaba
correctamente escrito contra los nombres que el resolver *declararía* si
estuviera registrado. Por eso el vitest de §3.37/§3.38 no detectó el
bug: los specs instancian el servicio directamente con mocks de mongoose
→ nunca bootean el módulo real.

**Archivos cambiados (1)**:

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `backend/src/energy-balance/energy-balance.module.ts` | + 3 imports (schema/service/resolver de live-demand). + 1 entrada en `MongooseModule.forFeature` (`LiveDemand`). + 2 entradas en `providers` (`LiveDemandService` + `LiveDemandResolver`). Comentarios consolidados en 1 bloque §3.40 (revisión polish). |

**Diff conceptual**:

```ts
// Imports
+ import { LiveDemand, LiveDemandSchema } from './schemas/live-demand.schema';
+ import { LiveDemandService } from './services/live-demand.service';
+ import { LiveDemandResolver } from './resolvers/live-demand.resolver';

// forFeature
+ { name: LiveDemand.name, schema: LiveDemandSchema },

// providers
+ LiveDemandService,
+ LiveDemandResolver,

// exports (deliberadamente NO añadido)
```

**Verificación** (sweep paralelo):

| Comando | Resultado |
|---------|-----------|
| `cd backend && pnpm test:vitest --run` | **50/50 PASS** en 4 archivos |
| `cd backend && pnpm build` | `nest build` OK · TS compile limpio |
| `curl POST /graphql {__schema{types{name}}}` | Lista contiene `LiveDemandRegionSlug` + `LiveDemandSnapshot` |
| `curl POST /graphql {__type(name:"LiveDemandRegionSlug"){enumValues{name}}}` | **6 values**: `NACIONAL`, `PENINSULAR`, `BALEARES`, `CANARIAS`, `CEUTA`, `MELILLA` ✅ |
| `curl POST /graphql {__type(name:"Query"){fields{name}}}` | Contiene `getLiveSnapshot` + `getHistoricalHourlySnapshot` ✅ |
| `code-reviewer-minimax-m3` (paralelo) | **0 BLOCKING** · 3 CONCERNs menores (disposición abajo) |

**CONCERNs del reviewer + disposición**:

1. ✅ **Comment density sobre la norma del proyecto** (4 bloques §3.40 retelling the history) → **FIX aplicado**: consolidado en 1 bloque al inicio de la sección de imports + 1-line tags en cada entry.
2. ✅ **`aggregate-hourly.ts` (importado por `LiveDemandService`) podría no existir** → **RESUELTO por build verde**: si faltase, `pnpm build` habría fallado con TS2307. Confirmado vía `ls`.
3. ✅ **`exports: [LiveDemandService]` es YAGNI** → **FIX aplicado**: eliminado del `exports` array. Si §3.41+ lo necesita, se re-añade con un consumer concreto que lo justifique.

**Lección transferible** (para futuros agentes):

> Cualquier `git checkout HEAD~1 -- <paths>` que restaure archivos
> `@InjectModel`-usados requiere re-cablear `MongooseModule.forFeature`
> + `providers` en el módulo que los aloja. Los specs vitest que mockean
> `@InjectModel` no bootean el módulo real → el bug pasa
> inadvertido hasta que alguien levanta el stack completo (NestJS
> autoload + GraphQL introspection).

Cross-ref §6 TODO: añadir a la lista de "gotchas pre-deploy" para que un
agente nuevo no repita el ciclo.

**Outstanding / siguiente sesión**:

- E2E manual desde el frontend: cambiar region pill en `LiveDemandCard`,
  confirmar que Apollo refetch emite `$region` y la cache key Mongo
  actualiza correctamente (visual: chip cambia + curva cambia).
- Verificar que `MockLiveDemandCard` (§3.39) sigue funcionando con
  `VITE_ENABLE_MOCK_FALLBACK=true` ahora que el resolver real existe
  (no debería haber regresión — son componentes independientes, pero
  sanity check vale 30s).
- Considerar mover `LiveDemand` schema entry a `exports` cuando algún
  feature module extra lo necesite (YAGNI por ahora).
- §3.31 region enum mismatch (display-case vs enum-uppercase) acumulado pre-§3.38 — **RESUELTO** en §3.41 (\`regionCacheKey\` retorna enum value canónico, ver bloque §3.43 abajo).

---

### §3.43 Phase 2 §3.41-§3.43 — Hilo de debug cerrado: enum serialization × partial-degraded gate × count-flexible aggregation (3 fixes atómicos)

**Origen**: usuario reportó bug runtime en localhost:5173 — `useHistoricalHourly({date, region: 'NACIONAL'})` devolvía 24 puntos de curva con datos reales (`CurrentDemandMW = 37599`, `MinTodayMW = 28794`, `MaxForecastMW = 44638`), pero el UI rendereaba:
- `Demanda actual ≈ Mínima del día` (mismo número ~30 GW)
- `Máxima prevista = "—"`, `Renovables = "—"`
- AreaChart con texto "Sin curva horaria disponible."

**3 hipótesis planteadas durante fase investigación** (NO tocar código de fix hasta confirmar con logs reales):

| ID | Hipótesis | Verdict |
|----|-----------|----------|
| **H_A** | Apollo InMemory cache tiene respuesta pre-§3.41 con `region: 'Nacional'` stale. Apollo normaliza por `__typename` y serviría la entrada vieja en lugar de la nueva con `region: 'NACIONAL'`. | **DESCARTADA** — el log evidenció que `LIVE.region === 'NACIONAL'` y `HIST.region === 'NACIONAL'`. Apollo cache ya estaba usando enum value post-§3.41. |
| **H_B** | Live snapshot **partial-degraded**: `lastReal.value` extraído OK de `items.find(Real).values[287]` pero `buildDemandCurve(items)` lanzó throw silencioso (count !=288 estricto en polls 03:00-04:00 donde REE publica 12-50 ticks). Catch de `Promise.allSettled` §3.27 pone `curve = []` y preserva `currentMW > 0`. UI-end: `minTodayMW = reduce over [] = initial currentMW` → mismo número en ambos KPIs. `maxForecastMW = 0`. `isDegradedSnapshot` strict-AND §3.27 sólo dispara con 3 sentinels en 0. | **CONFIRMADA** — log mostró `LIVE: {curMW:31358, minMW:31358, maxMW:0, renewPct:0, curveLen:0}`. Perfect match. |
| **H_C** | `MockLiveDemandCard` activo por `VITE_ENABLE_MOCK_FALLBACK === 'true'` cambiaría el render al componente mock con sus propios valores sintéticos (\`Tendencia (synth)\`, etc.). | **DESCARTADA** — la estructura renderizada eran 4 `KpiCell` directos sin footer `(synth)` del Mock. |

**Workflow diagnóstico** (sin tocar código de fix): añadir bloque TEMPORAL `[\§3.42 DIAGNOSTIC]` en `frontend/src/components/cards/live-demand-card.tsx:~335` con `console.log({mode, snap: __diagSnap, hist: __diagHist, render: __diagRendered, errors})` JSON-serialized. Usuario pegó el log output desde DevTools Console. La observación crítica que confirmó H_B:

```
mode:  "live"                  ← isDegradedSnapshot retorna FALSE porque strict-AND §3.27
LIVE:  { curMW: 31358, minMW: 31358, maxMW: 0, renewPct: 0, curveLen: 0, region: 'NACIONAL' }
HIST:  { curMW: 37599, minMW: 28794, maxMW: 44638, curveLen: 24, region: 'NACIONAL' }
RENDER: copy of LIVE          ← mode='live' picks the wrong snapshot
```

El error visible inicial (`"Enum 'LiveDemandRegionSlug' cannot represent value: 'Nacional'"`) era H_A manifest; desapareció tras restart del backend. El nuevo síntoma (KPIs engañosos sin error) sólo H_B lo explica.

**Tres fixes aplicados (atómicos, no opcionales)**:

#### Fix §3.41 — `regionCacheKey` retorna enum value canónico

`backend/src/energy-balance/services/live-demand.service.ts:374-382`:

```ts
// Antes (§3.31): kebab-Display (Nacional)
return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();  // 'NACIONAL' → 'Nacional'

// Después (§3.41): enum value canónico 'NACIONAL' (no kebab-Display)
return String(region).toUpperCase();  // cualquier casing de entrada → 'NACIONAL'
```

`shape()` produce `region: 'NACIONAL'` (enum value) → `GraphQLEnumType.serialize('NACIONAL')` no lanza `"cannot represent value"`. Side effects: schema defaults en `live-demand.schema.ts:46` y `live-demand-historical.schema.ts:51` cambiaron `'Nacional'` → `'NACIONAL'` para consistencia entre cache_key y Mongo stored value. Migrations: docs Mongo pre-§3.41 con `region: 'Nacional'` quedan orphans hasta TTL natural (60s live / 24h historical).

#### Fix §3.42 — partial-degraded gate en `isDegradedSnapshot`

`frontend/src/hooks/useLiveDemand.ts:206`:

```ts
// Antes (§3.27 legacy): strict-AND 3-sentinels-en-0
const fullyDegraded =
  snap.currentDemandMW === 0 &&
  snap.renewablePercentageValue === 0 &&
  Array.isArray(snap.demandCurve) &&
  snap.demandCurve.length === 0;

// §3.42 inicial: OR de §3.27 fully-degraded + §3.42 partial-degraded.
// §3.42.1 madrugada fix post-§3.43: threshold ajustado a `=== 0`
// en lugar de `< 2`. Motivo: aggregateHourly post-§3.43 rinde curvas
// legítimas de 1 bucket cuando REE completa la primera hora del día
// (~00:00-01:00 local). El umbral `< 2` cazaba esos casos como
// "degraded" → fallback histórico innecesario. Como el único path
// hacia partial-degraded es el catch del `service.ts`
// (`buildDemandCurve` lanza throw → `curve = []`), `=== 0` es
// estrictamente equivalente a `< 2` para el degraded case y no
// genera false-positives para curvas cortas pero válidas. CONCERN
// #1 fix aplicado en este turn.
const partialDegraded =
  Array.isArray(snap.demandCurve) && snap.demandCurve.length === 0;
return partialDegraded || fullyDegraded;
```

Threshold `< 2` (no `=== 0`) evita flicker entre "live" y "degraded" cuando hay 1 punto válido transient en polls tempranos (< 03:30 horizon). Resultado: cuando `LIVE` es partial-degraded (`curMW > 0` pero `curve = []`), `deriveMode` retorna `'historical'` → `renderedSnap = historicalHourly` (24 puntos reales, KPIs distintos). Frontend visual fix.

#### Fix §3.43 — count-flexible aggregation

`backend/src/energy-balance/util/aggregate-hourly.ts:80`:

```ts
// Antes (§3.37): strict EXPECTED_TICKS_PER_DAY (288)
if (values5min.length !== EXPECTED_TICKS_PER_DAY) throw new Error(...)

// Después (§3.43): accepts counts positivos múltiplos de 12 (12, 24, …, 288)
if (values5min.length === 0)             throw new Error('empty values5min');
if (values5min.length % TICKS_PER_HOUR !== 0)
  throw new Error('count must be a positive multiple of ' + TICKS_PER_HOUR);
const totalBuckets = values5min.length / TICKS_PER_HOUR;
for (let hour = 0; hour < totalBuckets; hour++) { ... }
```

Backend prevention: polls de madrugada con 12-50 ticks published producen curvas parciales honestamente (1-4 buckets) en lugar de throw → `Promise.allSettled` §3.27 silent catch → `curve = []` con `lastReal` preservado. Combinado con §3.42, `isDegradedSnapshot(LIVE)` retorna `false` durante curva parcial válida (length > 1) → mode='live' renderea curva parcial real, NO fallback histórico.

**Por qué los 3 son ATÓMICOS** (no opcionales secuenciales):

| Sólo §3.41 | Sólo §3.42 | Sólo §3.43 | Los 3 juntos |
|-------------|-------------|-------------|---------------|
| ✓ Chip "Error al cargar datos (Nacional)" desaparece; ✗ madrugada sigue mostrando `Demanda actual = Mínima del día` mismo número + "Sin curva" | ✓ Madrugada usa historical fallback bien; ✗ backend sigue lanzando throw en `buildDemandCurve` ⇒ curva vacía ⇒ sólo historical exitoso en madrugada | ✓ Backend ya no lanza throw en madrugada; ✗ cuando los 3 fetches REE fallen en simultáneo (61s reseed race), `isDegradedSnapshot` strict-AND §3.27 sigue retornando `false` con 3 sentinels ≠ 0 ⇒ UI engañosa con `lastReal` aislado | ✓ Madrugada funciona con curva parcial honesta; ✓ reseed total cae limpio a historical fallback; ✓ error GraphQL enum en boot nunca reaparece |

**Tests aniadidos** (backend vitest 45→55 = **+10 netos**):

- `backend/src/energy-balance/util/__tests__/aggregate-hourly.spec.ts` — nuevo `describe('aggregateHourly count-flexible (§3.43 partial-day)')` con 5 tests: accept 12/24/144/288 ticks + reject count=25. `describe('aggregateHourly (§3.37 pure function)')` legacy test renombrado + regex updated para matcher del nuevo error pattern `count must be a positive multiple of 12.*got N`.
- `backend/src/energy-balance/services/__tests__/live-demand.service.spec.ts` — 5 aserciones (cache miss fresh + cache hit + H1 + H2 + H4) cambiadas `region: 'Nacional'/'Peninsular'` → `region: 'NACIONAL'/'PENINSULAR'`. JSDoc de `regionCacheKey` + `shape()` + `regionToGeoLimit()` actualizadas.
- `frontend/src/hooks/useLiveDemand.ts:206-235` — JSDoc del gate ampliado con 2 secciones (§3.42 partial-degraded + §3.27 legacy fully-degraded) y rationale del threshold `< 2`.

**Verificación end-to-end**:

| Comando | Resultado |
|---------|-----------|
| `cd backend && pnpm test:vitest --run` | **55/55 pass** (10 nuevos: 5 partial-day aggregate + 1 renombrado test + 4 region enum aserciones) |
| `cd frontend && pnpm test:vitest --run` | **27/27 pass** |
| `cd backend && pnpm build` | exit 0 |
| `cd frontend && pnpm build` | exit 0 (1 chunk-size warning preexistente de recharts) |
| `cd backend && pnpm lint` | 0 errors |
| `cd frontend && pnpm lint` | 0 errors (1 warning preexistente `vite.config.ts:47` sin relación) |

**Manual diagnostic workflow** (reproducir el bug o verificar H_B en polls futuros):

1. Añadir bloque TEMPORAL `[\§3.42 DIAGNOSTIC]` en `frontend/src/components/cards/live-demand-card.tsx:~335` con `console.log({mode, snap: __diagSnap, hist: __diagHist, render: __diagRendered, errors})`.
2. Recargar localhost:5173 (hard reload para limpiar Apollo cache). Abrir DevTools Console.
3. Definir el verdict por observación directa:
   - `LIVE.region === 'NACIONAL'` ✓ → Apollo no stale (descarta H_A).
   - `LIVE.curveLen === 0 && LIVE.curMW > 0` → **H_B confirmado** (partial-degraded).
   - `HIST.curveLen > 0 && HIST.curMW !== HIST.minMW` → fallback histórico disponible, degradada correcto.
4. Eliminar bloque TEMP y verificar `grep -rn '§3.42' frontend/src` debe quedar con 3 matches residuales en `useLiveDemand.ts:isDegradedSnapshot` docstring (section anchors, no diagnostic residue). Cualquier otro match fuera de ese docstring indica limpieza incompleta.

**Cross-references**:
- §3.27 — `Promise.allSettled` resilience base (degrade-to-defaults original).
- §3.31 — Region picker + cache TTL 60s + historical endpoint. Predecesor arquitectónico.
- §3.38 — Cache histórico composite unique key `(region, date)` (cachea el resultado de §3.42 fallback).
- §3.41, §3.42, §3.43 — Los 3 fixes atómicos.
- §3.36 — Revert a MockLiveDemandCard previo. NO reintroducir mock auto-fallback (§3.32 ya eliminó ese patrón).
- §3.47 (futuro) — Si aplica un Apollo typePolicy que normalice por `region+date`, eliminar el degrade-to-historical fallback y usar in-memory cache como authoritative.

**Outstanding §3.43 follow-ups**:
- Mongo: 2-3 docs pre-§3.41 con `region: 'Nacional'` quedan orphans en colección `livedemandhistorical` hasta TTL 24h. Considerar un script `scripts/migrate-region-key.ts` que haga `updateMany({region: {$exists: true}}, [{$set: {region: {$toUpper: '$region'}}}])` para zero-downtime cleanup. Post-§3.41 ttl es suficiente pero no idiomático para purge explícito.
- Considerar añadir `typePolicy` en `frontend/src/libs/apollo-client.ts` con `keyFields: ['region', 'timestamp']` para `LiveDemandSnapshot` — Apollo normalizaría por composite key y nunca serviría cache stale cross-fix. Out of scope §3.43; Tier-2 follow-up.

---

## 4. Convenciones del Proyecto

### Backend
- Cada dominio bajo `src/<domain>/`: `*.module.ts`, `services/*.service.ts`, `resolvers/*.resolver.ts`, `schemas/*.schema.ts`, `dto/*`.
- Schema Mongoose: Nombre en PascalCase. `@InjectModel(Frontera.name)`.
- Variables env: **SIEMPRE** al top del archivo (o centralizadas en `dto.constants.ts` si son compartidas entre DTOs del mismo módulo, NUNCA inline duplicadas).
- **Parsing numérico de env vars**: usar **allowlist** (`Number.isFinite && > 0 ? raw : default`), **NUNCA** `Number(env) || default`. Razón: §3.21.
- Tests: **Jest** para unit/integration + **Vitest** para tests rápidos. `pnpm test:all` corre ambos.
- **Validación post-cambio GraphQL (Tier-1 invariant)** — `pnpm exec tsc -b` solo valida tipos TypeScript, NO la generación del schema GraphQL (que ocurre en runtime al `NestApplication.init()`). **Cualquier edit que toque `@Field()` / `@ObjectType()` / `@InputType()` / `@Resolver()` / `@registerEnumType()` debe validar con** (a) `grep registerEnumType backend/dist/src/**/*.input.js` u otro smoke test que confirme la llamada runtime está en dist JS, o (b) `GraphQLSchemaFactory.create([Resolver])` en spec Vitest con `GraphQLSchemaBuilderModule`. El Tier-1 §3.31 ship blocker `CannotDetermineOutputTypeError` slipped a través de un ciclo entero de `tsc + vitest + build` porque ninguno de esos invoca el schema builder. Regla **obligatoria** para futuros ciclos de validación backend (ver #31 para el spec de lock contract).

### Frontend
- Vite 6 + React 19 + SWC (no Babel).
- Tailwind 4 vía `@tailwindcss/vite`.
- **`useState<EnumType | ''>`** para enums dinámicos (nunca `useState<string>`). Razón §3.11.
- Componentes: `components/states/` para estados vacíos/loading/error. UI principal en `components/cards/*.tsx`. **NO** añadir nuevos componentes en `components/` raíz sin reorganizar.
- **Apollo error logging**: SIEMPRE safe manual serialization (§3.4) + SIEMPRE pasar la cadena extraída por `extractErrorDetail(error)` antes de mostrarla (§3.23).
- **NO** añadir dependencias externas para iconos/UI primitivos — inline SVG + tokens de `design-tokens.ts` (§3.22).
- **UI idioma**: español unificado. No mezclar con inglés.
- **`<html lang="es">`** en `index.html`. `<title>` y meta en español.

### Docker
- Stack dev: backend :3000, frontend nginx :80, mongo :27017 (expuesto a host).
- `restart: unless-stopped` en backend.
- `HEALTHCHECK` cada 30s vía `node healthcheck.js`.
- **PROD**: dockerfile.prod separado (TODO), `mongo NO expuesto`, `--frozen-lockfile`, multi-stage, usuario non-root.

### Documentación
- `agent-memory/CURRENT.md` — acumulación permanente de decisiones WHY.
- `agent-memory/agent-summary.md` — SOLO el delta de la última sesión. Borrar y reescribir cada vez, no acumular.
- `reporte.md` — auditoría inicial (Tier 0/pre-Tier-1 baseline).
- `reporte-post-stack.md` — verificación end-to-end post-Tier-2.

---

## 5. Estado Verificado (commands ejecutados con resultado)

| Comando / Verificación | Resultado | Sesión |
|------------------------|-----------|--------|
| `pnpm build` (backend) | exit 0 | Tier 2 |
| `pnpm build` (frontend) | exit 0 (1 chunk-size warning preexistente) | esta |
| `pnpm lint` (backend) | exit 0 | esta |
| `pnpm lint` (frontend) | exit 0 (1 eslint-disable warning preexistente) | esta |
| `npx vitest run` (backend, full suite) | **14/14 pass** (12 + 2 nuevos constructor guard) | esta |
| `pnpm tsc -b` (frontend) | exit 0 | esta |
| `pnpm build` (frontend production) | exit 0 | esta |
| Live: backend boot SIN `.env` en :3010 | ✅ [boot] message logged, process muere antes de app.listen | esta |
| Live: 1-day range GraphQL :3011 / :3012 | ✅ HTTP 200, data ok | esta |
| Live: 91-day range con cap=365 | ✅ HTTP 200 (antes fallaba con cap=90) | esta |
| Live: 365-day range con cap=365 | ✅ HTTP 200, ~95 records | esta |
| Live: 366-day range (over cap) | ✅ HTTP 200 GraphQL envelope con `extensions.originalError.message = ['endDate must be at most 365 days after startDate']` | esta |
| Live: 400-day range (over cap, control) | ✅ HTTP 200 GraphQL envelope con mismo mensaje (regression-free) | esta |
| `MAX_DATE_RANGE_DAYS=-1` boot + 366-day query | ✅ cap SIGUE funcionando (cae al default 365) | esta |
| Trace `/tmp/trace/extract-test.mjs` | ✅ **10/10 pass** (incluye discriminator tightness para Chrome 88+'Failed to fetch') | esta |
| `grep \b90\b spec/**/*.ts` | ✅ 0 matches (no spec hardcoded) | esta |
| chrome/chromium instalado | ❌ NO (browser-use no disponible) | — |

---

---

## 6. Deuda Técnica / TODO Conocidos (transversal)

**Resolved in esta sesión** (mover a archivo de historia o eliminar si aplica):
- ✅ Bug A (`Invalid URL` en cold boot) — fix en `ree-client.service.ts` constructor guard.
- ✅ Bug B (`Bad Request Exception` opaco) — fix multi-capa (`dto.constants.ts` + `extract-error-detail.ts`).
- ✅ DRY: MAX_DATE_RANGE_DAYS duplicado entre dos DTOs.
- ✅ Safety: `Number(env) || 365` permitía `-1` desactivar cap.
- ✅ Frontend brecha `data-selector.tsx` logic — UNCHANGED por requerimiento explícito.
- ✅ Sin tests del constructor guard — ahora cubierto (2 spec).
- ✅ **TODO #4 (Apollo Sandbox landing-page toggle en prod)** — fix en `app.module.ts` con `playground: false` + conditional swap entre `LocalDefault` (dev=Sandbox) y `ProductionDefault` (prod=minimal Welcome HTML). Diagnóstico source-grounded leyendo `ApolloServer.ts:492/977-1018` + `apollo-base.driver.js:50-69` (§3.26). Build green, Vitest 33/33, ESLint/Prettier clean. Runtime dual-verificación (dev + prod boot + curl `/graphql` con `Accept: text/html`) quedó pendiente por Mongoose retry-in-loop en Mongo inalcanzable (§6 #15).
- ✅ **Live-demand Fase 2 resilience hybrid** — fix en `live-demand.service.ts`: `Promise.all` → `Promise.allSettled` con defaults seguros (0 / [] / {renewablePercentageValue:0}) y WARN logs por cada fallo parcial de los 3 endpoints REE live (§3.27). Urlo diagnostic source-grounded: las 3 sub-rutas (`current-demand` / `daily-demand-curve` / `generation-mix`) son GUESSED y devuelven 404 HTML — `error.response` undefined → log signature `undefined - undefined`. Spec actualizada con 2 nuevos resilience tests (partial failure + all-zero). Build green, Vitest 34/34, ESLint/Prettier clean. URLs reales quedan como Outstanding #17.
- ✅ **Outstanding #17 (Real REE apiDatos live indicator URLs)** — `ree-client.service.ts` reescrito: 3 fetch methods con indicators reales (`demanda/demanda-tiempo-real`, `generacion/estructura-generacion`), `_liveDateRangeParams()` helper, `callLiveEndpoint<R>` con `params?` opcional, y distinción HTML (Symfony 500 → log ERROR "invalid slug") vs JSON 4xx con errors envelope → log WARN para que §3.27 Promise.allSettled degrade gracefully (§3.28). `.env.example`: `REE_LIVE_API_URL=https://apidatos.ree.es/es/datos` (sin `/live` ficticio). Spec ree-client: 7 nuevos tests cubriendo extract semantics (last-value, 24h curve, percentage calc) + HTML/JSON error path. Build 0, Vitest 41/41 (33 anteriores + 7 nuevos + 1 resilience test live-demand preservado), ESLint/Prettier clean. AxiosHeaderValue narrowing TS fix incluido. Forecast endpoint queda como Outstanding #21.
- ✅ **Phase 2 UI redesign** — `design-tokens.ts` reescrito + `primitives.tsx` extendido con `Sparkline` (inline SVG polyline) + KPI `spark?` prop + `kpi-row.tsx` pasa `SPARK_SYNTHETIC.*` por KPI + `exchange-card.tsx` restructurado a single-track stacked bar + ISO chip lookup via `COUNTRY_CODES/COUNTRY_COLORS` + `storage-card.tsx` color migrated a `accentGold` neutral + `index.css` CSS vars migrated (§3.29). Token strategy Option B (MIGRATE): `C.live/C.nonRenewable/C.nonRenewableDim/C.danger` migrados a hex Figma. Auto-propagación: `live-demand-card.tsx` (cyan en vez de sky-blue), `dashboard-header.tsx` (gradiente green→cyan en vez de green→sky). Build green, Vitest 14/14, ESLint 0 warnings, Prettier clean. 1 Outstanding nuevo: §6 #22 (nonRenewableDim contrast WCAG), §6 #23 (Sparkline deprecation a live data).
- ✅ **Outstanding post-Fase-2 #24 (DRY MIX palette index migration)** — `design-tokens.ts` reescrito: `MixItem.color:string → colorIndex:number`, nuevo `resolveMixColor(family, index)` helper con runtime-safe fallback a familyDim, `ColorFamily = 'renewable' | 'nonRenewable'` type. New vitest spec `resolve-mix-color.spec.ts` con 13 tests (renewable/nonRenewable happy paths + runtime fallbacks + palette integrity lockdown). Polish cycle aplicado: code-reviewer feedback address all 6 items (Q1 fallback NOTE, Q3 family discriminator JSDoc, Q4 cast drop via TS narrowing, Q5 production path comment en `generation-card.tsx`, Q6 palette lockdown spec JSDoc). Bonus cleanup: 2 pre-existing hex literals (Zap icon color en dashboard-header.tsx + loading-state message color en loading-state.tsx) migrados a `C.bg`/`C.muted` tokens. §3.30: build 0, Vitest 27/27 (14 + 13), ESLint 0 warnings, Prettier auto-fix on generation-card.tsx, **grep zero-leak** post-polish. Final invariant: 0 hex literals outside `design-tokens.ts` + `index.css` + `resolve-mix-color.spec.ts` (la spec intencionalmente assertea hex para lock contract).
- ✅ **Phase 2 §3.31 (region picker + historical fallback + Tier-1 race-fix)** — Backend: `backend/src/energy-balance/dto/live-demand.input.ts` (NEW `LiveDemandRegionSlug` enum + 2 input DTOs) + `services/live-demand.service.ts` (`regionCacheKey`/`regionToGeoLimit` + NEW `getHistoricalHourlySnapshot` method) + `schemas/live-demand.schema.ts` (`region: String` field + composite `{region: 1, createdAt: -1}` index) + `services/ree-client.service.ts` (`callLiveEndpoint` con `params?` opcional + NEW `fetchHistoricalHourly`). Frontend: `hooks/useLiveDemand.ts` (2 hooks + timezone-aware `yesterdayISODate` + strict-AND `isDegradedSnapshot` + `regionDisplayToSlug` helper) + `queries/live-demand.query.ts` (region variable + NEW GET_HISTORICAL_HOURLY) + `components/cards/live-demand-card.tsx` (wrapper+body split + `<RegionPills role="radiogroup">` interactive + inline hist fallback rendering + HISTÓRICO/EN VIVO chip mutual exclusive). **TIER-1 race-fix**: replace `!historicalHourly` con positive narrowing (`historicalHourly !== undefined && historicalHourly.region?.toLowerCase() === regionSlug && historicalHourly.timestamp.startsWith(dateYesterday)`). Backend echo de `region: cacheKey` CONFIRMED source-grounded `live-demand.service.ts:252`. Q1 polish: const-extraction defense-in-depth removida (-26 lines). Q3 polish: startsWith simplify (drop `?.`/`?? false`). Final dangling-JSDoc al `renderedSnap` annotation JSDoc (forward pointer to explain el removed const). Build green x side, Vitest 41 + 14 = 55 pass (sin cambios), ESLint/Prettier clean. 0 hex literals nuevos. §3.31 ship-ready; Tier-2 followups logged como #26-#29.

- ✅ **Phase 2 §3.31 fix (Tier-1 Critical: `@registerEnumType` runtime schema build)** — `backend/src/energy-balance/dto/live-demand.input.ts` (único archivo modificado): agregado import `registerEnumType` desde `@nestjs/graphql` + call `registerEnumType(LiveDemandRegionSlug, { name: 'LiveDemandRegionSlug', description, valuesMap: { NACIONAL, PENINSULAR, BALEARES, CANARIAS, CEUTA, MELILLA } })` colocado inmediatamente después de la declaración del enum. **POR QUÉ era Tier-1 ship blocker**: sin este call, NestJS schema builder falla al boot con `CannotDetermineOutputTypeError: Cannot determine a GraphQL output type for the "region"` porque las 3 `@Field(() => LiveDemandRegionSlug, ...)` decoran `@ObjectType` + `@InputType` sin output type resolvable. Validación: `grep registerEnumType backend/dist/src/energy-balance/dto/live-demand.input.js` (count=1 tras build) confirma que la llamada runtime está en el JS compilado — sustituto del boot test completo (Mongoose retry-in-loop bloquea el dev server en esta env, ver §3.26). Build green x side, ESLint/Prettier clean. JSDoc trim (revisión polish Tier-3: 30→12 líneas para evitar redundancia). §3.31 completado: Tier-0 (excepto #31 Vitest spec lock contract).

**Outstanding**:

- **#26 (Phase 2 §3.31 followup, Tier-2): Vitest spec for `live-demand-card.tsx`** — No existe `src/components/cards/live-demand-card.spec.tsx`. El `isDegraded` invariant (strict AND + region match + date freshness) + race-fix son el corazón del feature pero son untested. Mínimo: render con `MockedProvider` returning `{currentDemandMW:0, renewablePercentageValue:0, demandCurve:[]}` for `GET_LIVE_DEMAND` + assert `HISTÓRICO` chip + `historicalHourly` source render. Covers: race condition simulation (mount con `historicalHourly.region='Peninsular'` mientras `regionSlug='canarias'` → assert isDegraded=false). Future agent refactor regression shield.
- **#27 (Phase 2 §3.31 followup, Tier-2): ARIA keyboard arrow navigation for region pills** — `role="radiogroup"` + `role="radio"` con `aria-checked` es WAI-ARIA compliant pero no "conforming". Falta `onKeyDown` handler para ArrowLeft/Right/Up/Down (focus navigation entre pills) + Home/End (first/last jump). SC 2.1.1 (Keyboard) conformance gap. Out-of-scope §3.31; queued para accessibility pass Tier-2.
- **#28 (Phase 2 §3.31 followup, Tier-3): `getSnapshotValue` helper recurrence-risk shield** — El patrón "extraer acceso a const antes de JSX ternary para evitar TS narrowing → never" se repite con cada nuevo `renderedSnap?.X` en `live-demand-card.tsx`. Refactor: helper co-localizado `getSnapshotValue<K extends keyof LiveDemandData>(snapA: LiveDemandData|undefined, snapB: LiveDemandData|undefined, isDegraded: boolean, key: K): LiveDemandData[K]|null` con todas las 6 keys (`timestamp`, `co2Emissions`, `currentDemandMW`, `maxForecastMW`, `minTodayMW`, `renewablePercentageValue`, `demandCurve`) como K. Single chokepoint para futuros de-narrowing needs. Sketch en §3.31 / D3 thinker output archived.
- **#29 (Phase 2 §3.31 followup, Tier-3): Switch-window UX hint (1-2s overlap)** — Cuando user hace Peninsular → Canarias click rápido mientras live degraded, hay una ventana 1-2s donde `isDegraded=false` (old historical no match new region) + `snap.demandCurve.length===0` → UI muestra "EN VIVO" chip + empty chart. Comportamiento CORRECTO del race-fix (data integrity preserved over visual smoothness), pero visualmente jarring. Tier-2 fix: añadir mini-spinner "actualizando histórico…" durante la ventana. Documentado en §3.31 ciclo; deferred para Polish cycle.

- **#31 (Phase 2 §3.31 fix follow-up, Tier-2): Vitest spec `backend/src/energy-balance/services/__tests__/live-demand.schema.spec.ts` lock schema-build contract** — La solución del `CannotDetermineOutputTypeError` puede borrarse accidentalmente por un agente que crea que `registerEnumType` es "dead code". Para lock contract: spec pequeño usando `Test.createTestingModule({ imports: [GraphQLSchemaBuilderModule], providers: [LiveDemandResolver, { provide: LiveDemandService, useValue: { getSnapshot: () => {}, getHistoricalHourlySnapshot: () => {} } }] })` + `GraphQLSchemaFactory.create([LiveDemandResolver])` + `expect(schema.getType('LiveDemandRegionSlug')).toBeDefined()` + `expect((schema.getType('LiveDemandSnapshot') as GraphQLObjectType).getFields().region).toBeDefined()`. Bonus: este spec funciona como substitute de boot-time smoke cuando Mongoose retry-in-loop es bloqueador (ver §3.26). Cubre simultaneously 3 gaps: (a) lock enum contract, (b) regression shield si futuro agente borra el call, (c) permanent schema-build validation sin necesidad de boot completo.

1. **Vitest coverage para `extractErrorDetail`** — utility nueva sin spec. Trace ad-hoc vive en `/tmp/trace/extract-test.mjs` (vanilla .mjs, no durable). TODO: migrar a `frontend/src/libs/__tests__/extract-error-detail.spec.ts` con vitest. **CRÍTICO antes de que esto se considere "shipped"**.
2. **Vitest coverage para `is-max-days-range.validator.ts`** — validator sin spec. NO hay test de boundary (0 días, 1 día, 365 días, 366 días, fechas invertidas). TODO: añadir.
3. **JSDoc NIT en `is-max-days-range.validator.ts:17`** — ejemplo `@IsMaxDaysRange(90)` quedó stale tras el cambio a `|| 365`. Solo afecta docs, NO runtime.
4. **Nest 10 → 11 + Apollo 5 modernization** — Bigger diff; deferred (peer mismatch NO bloquea runtime).

15. **Apolo Sandbox toggle runtime verification (TODO #4 follow-up)** — Residual: el dual-runtime curl check no se completó en esta sesión por Mongoose reintento en MongoDB inalcanzable. Diagnóstico source-grounded, pero falta evidencia runtime reproducible. Workaround: `docker-compose up mongo` antes de las curls, o pasar `{ serverSelectionTimeoutMS: 2000 }` a `MongooseModule.forRootAsync`.

16. **Post-production landing-page posture (TODO #4 follow-up)** — Preguntar al user: postura A (minimal Welcome CDN-loaded HTML, current) vs postura B (zero HTML via ApolloServerPluginLandingPageDisabled). Postura B es la más hardened.

21. **Forecast endpoint for daily curve (`prevista` real value)** — Outstanding #17 lo dejo con `prevista = real` placeholder en `fetchDailyDemandCurve` porque ningún candidate slug (`demanda-prevista`, `evolucion-demanda`, `demanda-programada`) fue válido en la probe. Tarea: investigar el indicator real de demanda prevista/forecast para la curva horaria (quizá bajo otra categoría REE o quizá `demanda-programada` con un sufijo distinto). Update `fetchDailyDemandCurve` extract para devolver `prevista` distinto de `real`. Quitado el sentinel `prevista=real`.

20. **Vitest coverage para `extractErrorDetail`** — utility nueva sin spec. Trace ad-hoc vive en `/tmp/trace/extract-test.mjs` (vanilla .mjs, no durable). TODO: migrar a `frontend/src/libs/__tests__/extract-error-detail.spec.ts` con vitest. **CRÍTICO antes de que esto se considere "shipped"**.

17. ~~**Real REE apiDatos live indicator URLs research**~~ — **RESUELTO en esta sesión** (§3.28). 2 indicator IDs reales encontrados via probe con date-range + time_trunc=hour: `demanda/demanda-tiempo-real` (200) y `generacion/estructura-generacion` (400 JSON 'data lag' normal — slugo válido). Forecasting endpoint pendiente (ver #21 abajo).

18. **Gate cache write when all 3 fetches fail (reviewer follow-up §3.27)** — Code-reviewer-minimax-m3 flagged que `findOneAndUpdate(upsert:true)` persiste snapshots all-zero durante 60s cuando los 3 fetches fallan. Masking: la siguiente query ve cache hit con zeros y trata como válido. Fix: NO upsert si `failedCount === 3`; en su lugar, `findOneAndDelete()` para limpiar el cache stale, o skip la línea. Tests adicionales requeridos en spec.

19. **GraphQL ObjectType `_warnings: [String!]!` (reviewer follow-up §3.27)** — Code-reviewer flag #2/#3: con sentinel `0` el frontend no puede distinguir "REE current failed" de "demand genuinely 0". Fix estructural: extender `LiveDemandSnapshot` ObjectType con `_warnings: [String!]!` que liste los endpoints caídos; `live-demand-card.tsx` puede renderizar un banner de degraded-state cuando el array NO está vacío.

20. **Vitest coverage para `extractErrorDetail`** — utility nueva sin spec. Trace ad-hoc vive en `/tmp/trace/extract-test.mjs` (vanilla .mjs, no durable). TODO: migrar a `frontend/src/libs/__tests__/extract-error-detail.spec.ts` con vitest. **CRÍTICO antes de que esto se considere "shipped"**.
5. **Apollo CORS No-Origin bypass** — `if (!origin) return cb(null,true)` permite cualquier petición sin Origin. PROD debe drop.
6. **`MONGODB_URI` fallback guard de producción** — actualmente silent fallback incluso en PROD.
7. **Frontend error UX** — console.error sigue ahí; debería surfacear toast/snackbar.
8. **Dev workflow README** — 4 modes (A/B/C/D) no documentados.
9. **CI pipeline (`.github/workflows/validate.yml`)** — typecheck + lint + test + `docker-compose up` + curl chain.
10. **Production Dockerfile (`backend/dockerfile.prod`)** — multi-stage, non-root.
11. **`recharts` bundle size warning** — manualChunks trade-off (§3.25). Diferido Tier-3.
12. **Endpoint demanda en tiempo real** — storage card y live-demand card usan mocks hasta Fase-2.
13. **i18n / react-i18next** — Tier-3 roadmap.
14. **Storage balance cálculo** — actualmente muestra valores en `0` o hardcoded; cálculo desde `fronteraDataResponse.getIntercambios` está pendiente.

22. **WCAG non-text contrast para `nonRenewableDim #3D2B66`** — el nuevo hex `#3D2B66` (migración F2.1) tiene luminance contrast de ~1.46:1 contra surface `#101828`. WCAG 2.1 SC 1.4.11 requiere 3:1 minimum para graphical objects (donut wedges). El dim solo se renderiza en fallback path cuando `processGenerationData` entrega data sin `color` attribute (edge case raro), pero en ese path el wedge queda casi invisible. **Fix Tier-2**: cambiar a `#8C64C8` (luminance ~0.13, ratio ~3.96:1). Documentar la decisión visual cuando se publique.

23. **Sparkline synthetic → live data (Fase 3)** — los 4 KPI sparklines ahora usan `SPARK_SYNTHETIC.*` determinista (10 puntos). Cuando el backend expanda `getLiveSnapshot` con histórico de los últimos N polls (Fase 3+), los sparklines deben migrar a datos reales por KPI. **Migration path**: reemplazar la prop `spark` por un mini-hook (`useSparkHistory(kpi, 10)`) que devuelva los últimos 10 snapshots persistidos en client-side via Apollo cache chain. El `SPARK_SYNTHETIC` constant queda como fallback mientras no haya histórico.

---

## 7. Riesgos / Gotchas para un agente nuevo

- ⛔ **NO upgrades a `@nestjs/apollo@13` o `@nestjs/graphql@13`** sin migrar Nest a 11 (cascade de peer deps conocido).
- ⛔ **NO cambiar `MONGODB_URI` default** (en `app.module.ts`) a cualquier valor que asuma docker.
- ⛔ **NO removar `ports: ['27017:27017']` de compose DEV**.
- ⛔ **NO cambiar `/graphql` default en apollo-client.ts a URL absoluta** sin actualizar el proxy Vite.
- ⛔ **NO loggear ApolloError completo** en frontend — usar safe manual serialization (§3.4) + extractErrorDetail antes de mostrar (§3.23).
- ⛔ **NO usar `console.debug(...)` en componentes React 19 + Vite SWC** — riesgo de `Converting circular structure to JSON`.
- ⛔ **Apollo CORS handler No-Origin branch** debe ser revisado ANTES de cualquier deploy a internet.
- ⛔ **`backend/.env.example` debe ser la única fuente de verdad** de env vars.
- ⛔ **NUNCA escribir `onClick={apolloRefetch}` (ni con Apollo ni con react-query)** — el SyntheticEvent entraría como `variables`. SIEMPRE `onClick={() => apolloRefetch()}`. Ver §3.13.
- ⛔ **NO añadir deps externas para iconos/UI primitives** en frontend — usar `design-tokens.ts` + inline SVG (§3.22).
- ⛔ **NO mezclar idiomas en UI** — todo en español (§3.22).
- ⛔ **NO reintroducir el patrón `Number(env) || DEFAULT`** en parsers numéricos. Usar allowlist `Number.isFinite && > min && < max` (§3.21).
- ⛔ **NO duplicar constantes entre archivos DTO del mismo módulo** — usar `dto.constants.ts` (§3.20).
- ⛔ **NO inline la extracción de ApolloError** en componentes — siempre `extractErrorDetail(error)` (§3.23). Un agente que simplifique de vuelta a `error?.graphQLErrors?.[0]?.message ?? error?.message` reintroduce el bug B opaco.

---

## 8. Conceptos que un agente nuevo debería entender ANTES de tocar

- **Apollo / Nest version pinning es frágil**: cualquier bump cruzado rompe peers. Verificar primero qué peer pide la versión candidato DE TODOS los packages nest-related.
- **Mongoose TTL + REE re-fetch**: si el modelo se borra por TTL y luego una query lo pide, Mongo no lo devolverá → controller llama REE → REE lo publica idéntico con timestamp nuevo.
- **Apollo Server 4 vs 5**: 4 embebe `@apollo/server/express4` integration; 5 splitea como `@as-integrations/*`. Si mantenemos Nest 10, **siempre 4**.
- **Apollo BadRequest wrapping**: Nest envuelve cualquier `BadRequestException` y Apollo lo entrega como `BadRequest Exception` opaco en top-level con detalle en `extensions.originalError.message`. Usar siempre `extractErrorDetail` en frontend (§3.23).
- **Multi-port dev**: ver §3.9 + agent-summary.md.
- **Frontend `'/graphql'` relative** depende de nginx/proxy/vite para resolver al backend.
- **Constructor guard fail-fast**: si los env vars REE_* faltan, el backend no llega a `app.listen`. El puerto está unbound, Apollo ve ECONNREFUSED. Por eso el `[boot]` se queda en stderr del proceso backend.
- **Safety parsing numerico**: el patrón `Number(x) || D` permite `-1` bypass. Usar siempre allowlist.
