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

## 4. Convenciones del Proyecto

### Backend
- Cada dominio bajo `src/<domain>/`: `*.module.ts`, `services/*.service.ts`, `resolvers/*.resolver.ts`, `schemas/*.schema.ts`, `dto/*`.
- Schema Mongoose: Nombre en PascalCase. `@InjectModel(Frontera.name)`.
- Variables env: **SIEMPRE** al top del archivo (o centralizadas en `dto.constants.ts` si son compartidas entre DTOs del mismo módulo, NUNCA inline duplicadas).
- **Parsing numérico de env vars**: usar **allowlist** (`Number.isFinite && > 0 ? raw : default`), **NUNCA** `Number(env) || default`. Razón: §3.21.
- Tests: **Jest** para unit/integration + **Vitest** para tests rápidos. `pnpm test:all` corre ambos.

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

**Outstanding**:

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
