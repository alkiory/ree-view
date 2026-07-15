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
│   │   └── energy-balance/        módulo feature (schemas, services, resolvers)
│   ├── scripts/predev-cleanup.js NEW (auto-kill orphans de :3000, ver §3.5)
│   ├── healthcheck.js             async IIFE wrap (CJS, ver §3.6)
│   ├── dockerfile                 pnpm@10.5.2, HEALTHCHECK=healthcheck.js
│   ├── .env.example               CORS_ORIGINS, MONGODB_URI, REE_*, throttle, TTL, etc.
│   └── package.json               predev → predev-cleanup.js; dev → nest start --watch
├── frontend/               Vite 6 + React 19
│   ├── src/
│   │   ├── libs/apollo-client.ts  VITE_API_URL ?? '/graphql' (relative, ver §3.3)
│   │   ├── hooks/use{Energy,Frontera}Data.ts  safe error logging (ver §3.4)
│   │   └── components/            UI + states/
│   ├── vite.config.ts             server.proxy['/graphql'] → BACKEND_URL (ver §3.3)
│   └── nginx.conf                 location /graphql → backend:3000 (Docker mode)
├── docker-compose.yml             backend + frontend + mongo
└── [docs y archivos raíz]
```

---

## 3. Decisiones Críticas (con POR QUÉ)

### 3.1 Apollo Server downgrade 5 → 4

**Pins exactos** (en `backend/package.json`):
- `@apollo/server: ^4.10.0`
- `@nestjs/apollo: ^12.2.0`
- `@nestjs/graphql: ^12.2.0`

**POR QUÉ**: Apollo 5 + @nestjs/apollo 13 + @nestjs/graphql 13 imponen peers a Nest 11 + Express 5 + `@as-integrations/express5`. El backend está en **Nest 10 + Express 4**. Peer mismatch producía `MODULE_NOT_FOUND @apollo/server` y `package "@as-integrations/express5" missing` en runtime Docker. Tras 2 iteraciones de "añadir peer → rebuild → crash → añadir peer", bajamos toda la torre al ecosistema Nest 10.

**Trade-off**: Perdemos Apollo 5 features (response caching configurable, persisted queries, sandbox UI rediseñado). **No se usan en código actual**.

> ⚠️ Future Tier 3 — modernizar a Nest 11 + Apollo 5. Cambio masivo (también Express 5, NestJS 11 breaking en DI/migrations/tests). NO hacerlo antes de evaluar tráfico de subscriptions o features Apollo 5.

### 3.2 Mongo URI graceful fallback

**Decisión** (`backend/src/app.module.ts`):

```ts
MongooseModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const uri = config.get<string>('MONGODB_URI');
    if (!uri) { logger.warn('... fallback ...'); return { uri: DEFAULT_MONGO_URI }; }
    return { uri };
  },
})
const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/energy-balance';
```

**POR QUÉ**: devs nuevos haciendo `git clone && cd backend && pnpm dev` sin `.env` configurado crasheaban con `MongooseError: uri parameter must be a string`. Con Docker Compose el `MONGODB_URI` se inyecta vía env block al servicio; en host dev ese path interno no es alcanzable, así que el fallback local es lo único que arranca.

**POR QUÉ NO fail-fast**: queremos DX amigable; warning de log indica claramente el fallback. Para silenciar el warning devs crean `backend/.env` desde `.env.example`.

> ⚠️ Deuda técnica: en PRODUCCIÓN el fallback silencioso podría parecer-OK pero apuntar a nada. **PROD debe tener MONGODB_URI explícito** y el factory NO debe caer al default. TODO: añadir guard `if (process.env.NODE_ENV === 'production' && !uri) throw new Error(...)`.

### 3.3 Vite proxy `/graphql` + apollo-client relative URL

**Decisiones**:
- `frontend/src/libs/apollo-client.ts`: `apiUrl = import.meta.env.VITE_API_URL ?? '/graphql'` (URL **relativa**).
- `frontend/vite.config.ts`: `server.proxy['/graphql']` → `process.env.BACKEND_URL || process.env.VITE_API_URL || http://localhost:3000`, con `changeOrigin: true, ws: true, strictPort: true`.

**POR QUÉ (dos cambios coordinados)**:

Originalmente `apollo-client.ts` tenía `apiUrl ?? 'http://localhost:3000/graphql'`. Con Docker compose seteando `VITE_API_URL=http://backend:3000/graphql`, el browser intentaba resolver hostname `backend` (interno Docker, no resuelve desde navegador del dev) → **DNS fail → CORS error displayed**. Con:

1. **URL relativa `/graphql`** → browser solo conoce mismo origen (5173 dev / 80 Docker). Resuelve siempre.
2. **Vite proxy** → en dev `:5173/graphql` se redirige al backend configurado (BACKEND_URL).
3. **nginx proxy** en frontend container → mismo path `/graphql` → `http://backend:3000` (Docker network interna). Sin CORS en producción.

**Caveats** (importantes — agente nuevo debe respetarlos):
- ⚠️ Si `VITE_API_URL` se setea como URL absoluta (ej `https://api.staging.com`), Apollo **bypassea el proxy** (cada llamada va directo a la URL). Es INTENCIONAL para reproducir staging en local; documentado en comentarios de `vite.config.ts`.
- ⚠️ `ws: true` anticipa `graphql-ws` (subscriptions); Nest 12 no las usa todavía pero el path queda abierto.
- ⚠️ `strictPort: true` falla rápido si :5173 está ocupado (mejor que el shift a :5174 silencioso).

### 3.4 Safe Apollo error logging (frontend)

**Decisión** (`frontend/src/hooks/{useEnergyData,useFronteraData}.ts`):
```ts
console.error('GraphQL Error (Energy):', {
  name: error?.name,
  message: error?.message,
  graphQLErrors: error?.graphQLErrors?.map?.((e: any) => e?.message),
  networkError: (error?.networkError as Error | undefined)?.message,
});
```

**POR QUÉ**: ApolloError en React DevTools contiene referencias `__reactFiber$xxx → FiberNode.stateNode → HTMLButtonElement` que cierran un ciclo. `console.error('... ', error)` con el objeto entero provoca JSON.stringify circular → `Uncaught TypeError: Converting circular structure to JSON`.

**POR QUÉ manual y no helper util**: solo 2 hooks duplicados (~5 líneas idénticas). DRY sería tentador pero añadir un helper genérico aporta complejidad sin valor; si aparece un 3er hook idéntico, extraer entonces.

> ⚠️ Regla: NUNCA pasar el `error` de ApolloError completo a `console.error`. Usar SIEMPRE safe manual serialization.

### 3.5 `backend/scripts/predev-cleanup.js` (orphan-killer)

**Decisión**: hook npm `predev` antes de `dev = nest start --watch`. Mata PIDs en :3000 cuyo `comm` empieza con `node` o contiene `nest`. Docker-owned :3000 (comm=`docker-proxy`) queda intacto + mensaje helpful.

```bash
# backend/package.json scripts:
"predev": "node ./scripts/predev-cleanup.js",
"dev": "nest start --watch",
```

**POR QUÉ**: sesiones previas donde devs intentaron `pnpm dev` después de `docker-compose up` chocaban con EADDRINUSE porque :3000 ya tenía backend Docker.

**POR QUÉ heurística `comm`-based**: filtra solo devs (no mata `mongod` accidentalmente). Funciona en Linux (`ss -ltnp`) + macOS/BSD (`lsof -ti`).

**Trade-offs**:
- ⚠️ SIGKILL escalonado a 800ms es **racy** vs `nest start --watch` que arranca inmediatamente después. Solo impacta caso edge con un orphan local YA presente en :3000 (cuando Docker ya la tiene, el script detecta comm `docker-proxy` y NO intenta matar → no hay race).
- ⚠️ NO documenta en README los comandos manuales fallback (`docker-compose stop && pkill -f 'nest start'`). TODO.

### 3.6 `backend/healthcheck.js` async IIFE wrap

**Decisión**: `(async () => { try { ... await ... } catch {...} })()` en vez de `try { await ...; }`.

**POR QUÉ**: `backend/package.json` no tiene `"type": "module"`, así que `healthcheck.js` corre como **CommonJS** y top-level `await` falla con `SyntaxError`. El Dockerfile ejecuta `node healthcheck.js` y Docker HEALTHCHECK reportaba `unhealthy` aunque el backend respondía 200.

**Si en el futuro**: package.json pasa a `"type": "module"`, top-level await es legal → refactorizar a flat.

### 3.7 `docker-compose.yml` mongo:`27017` → host

**Decisión**: añadido `ports: ['27017:27017']` al servicio `mongo`.

**POR QUÉ**: `pnpm dev` en host (con fallback §3.2 → `mongodb://localhost:27017/energy-balance`) necesita Mongo alcanzable desde el host. Sin port-forwarding, devs requerirían instalar Mongo localmente.

> ⚠️ **PROD debe usar compose separado sin esta línea** (mongo interno-only). TODO: `docker-compose.prod.yml` separado.

### 3.8 CORS_ORIGINS dos-origen default

**Decisión** (`backend/src/main.ts`): default `'http://localhost:5173,http://localhost:80'` cuando env var ausente.

**POR QUÉ**: ambas direcciones válidas en dev (Vite + Docker nginx). En PROD necesitará el dominio real vía `CORS_ORIGINS=https://midominio.com`.

**POR QUÉ `(env || default)` y no `??`**: empty string `''` también cae al default. Previene bloqueo accidental por typo `CORS_ORIGINS=` (vacío).

> ⚠️ Apollo CORS handler es **permisivo**: `app.enableCors({ origin: (origin, cb) => { if (!origin) return cb(null, true); if (allowed.includes(origin)) return ...else... } })`. La rama `if (!origin) return cb(null, true)` permite peticiones **sin Origin header** (curl, server-to-server, Postman) sin validar contra whitelist. Útil en dev pero **PROD debería drop esta rama** o restringir `'reflect'`. TODO.

### 3.9 Convention `PORT=3001 pnpm dev` (NO workaround)

**Decisión oficial**: devs con Docker stack levantado deben correr `cd backend && PORT=3001 pnpm dev` para no colisionar con Docker :3000.

**POR QUÉ** (no solución alternativa): predev-cleanup NO mata Docker-owned :3000 (comm=`docker-proxy` ≠ `node|nest`). Devs sin `PORT=3001` chocan EADDRINUSE.

**Regla**: esta convención NO está escrita en README. TODO. (Próxima).

### 3.10 EnergyBalance + Fronteras TTL index

**Decisión**: TTL via `@Prop({ index: { expireAfterSeconds: CACHE_TTL_SECONDS } })` con `CACHE_TTL_SECONDS=86400` (24h).

**POR QUÉ**: REE publica daily; 24h cubre micro-revisiones sin stale.

**Caveat**: TTL expira `createdAt`, no `updatedAt`. Datos viejos resucitan si la query los pide y el fetch de REE los devuelve idénticos (timestamp `createdAt` nuevo).

### 3.11 `DataSelector` EnergyGroupId type-narrowing

**Decisión** (frontend):
```ts
interface EnergyTypes { Renovable: ...; 'No-Renovable': ... }
type EnergyGroupId = 'Renovable' | 'No-Renovable';
const [selectedGroup, setSelectedGroup] = useState<EnergyGroupId | ''>('');
```

**POR QUÉ**:
- SWC parser crash con `readonly [K in EnergyGroupId]` mapped-type syntax → keys explícitos.
- `useState<string | ''>` → TS7053 al indexar `energyTypes[selectedGroup]`.
- `useState<EnergyGroupId | ''>` permite que `e.target.value` (string) acepte via cast narrowing.

**Regla**: para enums dinámicos, SIEMPRE `useState<EnumType | ''>('')` (no `useState<string>`).

### 3.12 `useFronteraData.ts` Frontera renombrado a `Frontera` singular

**Decisión**: Schemas Mongoose singulares (`Frontera`, `EnergyBalance`) con mayúscula. Tipo E/S en código consistente con el singular.

**POR QUÉ**: convención NestJS-Mongoose `name string` — `MongooseModule.forFeature([{ name: EnergyBalance.name, schema: EnergyBalanceSchema }])`. El `name` identifica el modelo en el registry; plurales rompen consistencia con `@nestjs/mongoose@11`.

---

## 4. Convenciones del Proyecto

### Backend

- Cada dominio bajo `src/<domain>/`: `*.module.ts`, `services/*.service.ts`, `resolvers/*.resolver.ts`, `schemas/*.schema.ts`.
- Schema Mongoose: Nombre en PascalCase. `@InjectModel(Frontera.name)`.
- Variables env: **SIEMPRE** al top del archivo, nunca dentro de funciones (mejor tree-shaking y descubribilidad).
- Tests: **Jest** para unit/integration (con `mongodb-memory-server@11`) + **Vitest** para tests rápidos. `pnpm test:all` corre ambos en secuencia.
- ESLint + Prettier configurados con NestJS preset; no añadir reglas custom sin motivo claro.

### Frontend

- Vite 6 + React 19 + SWC (no Babel).
- Tailwind 4 vía `@tailwindcss/vite` (sin PostCSS config).
- `useState<EnumType | ''>` para enums dinámicos (nunca `useState<string>`).
- Componentes: `components/states/` para estados vacíos/loading/error. Raíz `components/` para UI.
- **Apollo error logging: SIEMPRE safe manual serialization** (ver §3.4).

### Docker

- Stack dev: backend :3000, frontend nginx :80, mongo :27017 (expuesto a host).
- `restart: unless-stopped` en backend (auto-recovery).
- `HEALTHCHECK` cada 30s vía `node healthcheck.js` (start-period 40s, retries 3).
- **PROD**: dockerfile.prod separado (TODO), `mongo NO expuesto`, `--frozen-lockfile`, multi-stage, usuario non-root.

---

## 5. Estado Verificado (commands ejecutados con resultado)

| Comando / Verificación | Resultado | Sesión |
|------------------------|-----------|--------|
| `pnpm build` (backend) | exit 0 | Tier 2 |
| `pnpm build` (frontend) | exit 0 con `_getIntercambios` rename | post-Tier 1 fix |
| `docker-compose build --no-cache backend` | exit 0 (Apollo 4 stack) | dep-cascade fix |
| `docker-compose build --no-cache frontend` | exit 0 (TS6133 fix) | post-storage-balance fix |
| `docker-compose up -d --build` | backend **unhealthy → healthy** | post-healthcheck IIFE fix |
| `curl http://localhost:3000/graphql {__typename}` | HTTP 200 | dep-cascade fix |
| `curl http://localhost:80/graphql {__typename}` | HTTP 200 (nginx proxy) | post-nginx proxy fix |
| `curl http://localhost:80/graphql getEnergyBalances` | HTTP 200 + 21 records | Tier 2 final |
| `curl http://localhost:5173/graphql` (vite proxy + `BACKEND_URL=3001`) | HTTP 200 + matching payload | última sesión |
| `OPTIONS http://localhost:5173/graphql` | HTTP 204 + CORS headers | última sesión |
| `node scripts/predev-cleanup.js` standalone | exit 0, kills orphan local, leaves Docker | última sesión |
| `pnpm dev PORT=3001` foreground | clean boot, GraphQL 200 | última sesión |

---

## 6. Deuda Técnica / TODO Conocidos (transversal)

1. **Nest 10 → 11 + Apollo 5 modernization** — Bigger diff; deferred (peer mismatch warning NO bloquea runtime).
2. **Apollo CORS No-Origin bypass** — `if (!origin) return cb(null,true)` permite cualquier petición sin Origin. **PROD debe drop**.
3. **`MONGODB_URI` fallback guard de producción** — actualmente silent fallback incluso en PROD. TODO: throw si `NODE_ENV=production && !uri`.
4. **predev-cleanup.js race** — 800ms SIGKILL grace vs `nest start --watch` immediato. Edge case, no bloqueante.
5. **mongo:27017 exposed to host in dev compose** — REMOVE para prod compose (separado).
6. **Frontend error UX** — console.error sigue ahí; debería surfacear un toast/snackbar en UI. Tier 3.
7. **Dev workflow README** — 4 modes (A/B/C/D) no documentados, comandos `docker-compose stop && pkill -f 'nest start'` no escritos.
8. **CI pipeline (`.github/workflows/validate.yml`)** — typecheck + lint + test + `docker-compose up` + curl chain.
9. **Production Dockerfile (`backend/dockerfile.prod`)** — `--frozen-lockfile`, multi-stage, non-root.
10. **`scripts/verify-stack.sh`** — automatiza las cadenas manuales repetidas en cada sesión.
11. **Tests para `predev-cleanup.js` + Vite proxy** — validados manualmente; sin unit tests.
12. **`PORT=3001` convention en README** — recurrentemente verdeada por devs; debería estar en sección dev.

---

## 7. Riesgos / Gotchas para un agente nuevo

- ⛔ **NO upgrades a `@nestjs/apollo@13` o `@nestjs/graphql@13`** sin migrar Nest a 11 (cascade de peer deps conocido).
- ⛔ **NO cambiar `MONGODB_URI` default** (en `app.module.ts`) a cualquier valor que asuma docker — devs en host perderán conexión.
- ⛔ **NO removar `ports: ['27017:27017']` de compose DEV**.
- ⛔ **NO cambiar `/graphql` default en apollo-client.ts a URL absoluta** sin actualizar el proxy Vite.
- ⛔ **NO loggear ApolloError completo** en frontend — usar safe manual serialization (§3.4).
- ⛔ **NO usar `console.debug(...)` en componentes React 19 + Vite SWC** — riesgo de `Converting circular structure to JSON` (ver conversiones previas en storage-balance.tsx).
- ⛔ **Apollo CORS handler No-Origin branch** debe ser revisado ANTES de cualquier deploy a internet.
- ⛔ **`backend/.env.example` debe ser la única fuente de verdad** de env vars — NO añadir vars "libres" en código sin documentarlas aquí también.

---

## 8. Conceptos que un agente nuevo debería entender ANTES de tocar

- **Apollo / Nest version pinning es frágil**: cualquier bump cruzado rompe peers. Verificar primero qué peer pide la versión candidato DE TODOS los packages nest-related.
- **Mongoose TTL + REE re-fetch**: si el modelo se borra por TTL y luego una query lo pide, Mongo no lo devolverá → controller llama REE → REE lo publica idéntico con timestamp nuevo. Pensar caching strategy Tier 3.
- **Apollo Server 4 vs 5**: 4 embebe `@apollo/server/express4` integration; 5 splitea como `@as-integrations/*`. Si mantenemos Nest 10, **siempre 4**.
- **Multi-port dev**: ver §3.9 + agent-summary.md de la última sesión.
- **Frontend `'/graphql'` relative** depende de nginx/proxy/vite para resolver al backend. Si cambias el default, actualiza proxy-Vite y nginx.conf simultáneamente.
