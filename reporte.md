# 📋 Auditoría Inicial — Proyecto `ree-view`

> **Propósito**: Este documento captura el estado del proyecto **antes** de aplicar las mejoras del **Tier 1** (corrección de bugs críticos, CORS seguro y externalización de configuración).
>
> Una vez completado Tier 1, este será el baseline contra el cual comparar el "después".
>
> **Fecha de auditoría**: 15 de julio de 2026
> **Metodología**: Framework **RPI** *(Research → Planning → Implementation)*

---

## 1. Información General

| Campo | Valor |
|-------|-------|
| Nombre | `ree-view` (Balance Eléctrico Nacional) |
| Repositorio | github.com/SergioCampbell/ree-view |
| Tipo | Aplicación fullstack de monitoreo energético |
| Fuente de datos | API pública de REE (Red Eléctrica de España) |
| Frontend dev port | `http://localhost:5173` |
| Backend dev port | `http://localhost:3000/graphql` |
| Modo de ejecución | Local (`pnpm`) o Docker Compose |

### Descripción funcional

Aplicación fullstack que consume la API de **REE** para visualizar el balance eléctrico del sistema eléctrico nacional español, con:

- Filtros por **rango de fechas** y **tipo de energía** (renovable vs. no-renovable).
- Visualización de **generación** desglosada por tecnología.
- Visualización de **demanda** promedio.
- Intercambios internacionales en **fronteras** (Portugal, Francia, Andorra, Marruecos).
- Tabla de **balance de almacenamiento**.

---

## 2. Stack Tecnológico (estado inicial)

### Frontend (`frontend/`)

| Tecnología | Versión | Uso |
|------------|---------|-----|
| React | 19.0.0 | UI declarativa |
| Vite | 6.3.1 | Bundler y dev-server |
| TypeScript | 5.7.2 | Tipado estático |
| Apollo Client | 3.13.8 | Cliente GraphQL con caché |
| react-datepicker | 8.3.0 | Selector de fechas |
| recharts | 2.15.3 | Gráficos |
| Tailwind CSS | 4.1.4 | Estilos utility-first |

> ⚠️ **Observación inicial**: No existía `frontend/src/vite-env.d.ts` para tipos de variables `import.meta.env`.

### Backend (`backend/`)

| Tecnología | Versión | Uso |
|------------|---------|-----|
| NestJS | 10.x | Framework de servidor |
| GraphQL | 16.10.0 | Capa de API |
| Apollo Driver | 13.1.0 | Adaptador GraphQL para Nest |
| Mongoose | 8.13.2 | ODM para MongoDB |
| Axios | 1.8.4 | Cliente HTTP a REE |
| TypeScript | 5.1.3 | Tipado estático |

### Infraestructura

- **MongoDB 6.0** como caché local de respuestas REE.
- **Docker Compose v3** con tres servicios: `backend`, `frontend`, `mongo`.

---

## 3. Arquitectura General

```
┌─────────────┐      HTTPS       ┌─────────────────────┐
│  REE API    │ ────────────────►│  ReeClientService   │
│ (apidatos.  │                  │  (NestJS proxy)     │
│  ree.es)    │                  └──────────┬──────────┘
└─────────────┘                             │ Axios
                                            ▼
                            ┌──────────────────────────┐
                            │ EnergyBalanceService /   │
                            │ FronteraService          │
                            │ (cache-on-first-request) │
                            └──────────┬───────────────┘
                                       │ Mongoose
                                       ▼
                            ┌──────────────────────────┐
                            │      MongoDB 6.0         │
                            └──────────┬───────────────┘
                                       │
                            GraphQL    │
                            ◄──────────┘
                            ┌──────────────────────────┐
                            │ Apollo Server /graphql   │
                            └──────────┬───────────────┘
                                       │
                            HTTP+CORS  │ (origin: '*')
                                       ▼
                            ┌──────────────────────────┐
                            │  Apollo Client (Vite)    │
                            │  fetchPolicy: 'no-cache' │
                            └──────────┬───────────────┘
                                       │
                                       ▼
                            ┌──────────────────────────┐
                            │  React UI Components     │
                            │ (EnergyChart, Demand...) │
                            └──────────────────────────┘
```

---

## 4. Análisis RPI

### 🔬 R — Research (Investigación realizada)

**Preguntas respondidas**:

- ✅ ¿De qué trata? → Visualizador del balance eléctrico nacional español vía API pública de REE.
- ✅ ¿Cómo se inicia? → `pnpm install` + `pnpm run dev` (por separado) o `docker-compose up -d`.
- ✅ ¿Se puede mejorar? → Sí. Múltiples issues de severidad variable categorizados en 3 tiers.

**Archivos inspeccionados exhaustivamente**:

| Archivo | Rol | Comentario |
|---------|-----|------------|
| `backend/src/main.ts` | Bootstrap + CORS | **CORS laxo** |
| `backend/src/app.module.ts` | Composición DI | OK, falta rate-limiting |
| `backend/src/energy-balance/services/ree-client.service.ts` | Cliente API REE | OK, bien factorizado |
| `backend/src/energy-balance/services/energy-balance.service.ts` | Servicio de balance | **Bug crítico** en query |
| `backend/src/energy-balance/services/frontera.service.ts` | Servicio de fronteras | OK |
| `backend/src/energy-balance/resolvers/*.ts` | Resolvers GraphQL | Uso de `console.log` |
| `backend/src/energy-balance/dto/*.ts` | Tipos GraphQL | OK |
| `backend/src/energy-balance/schemas/*.ts` | Esquemas Mongoose | `attributes` como `Object` plano |
| `frontend/src/App.tsx` | Estado global | OK |
| `frontend/src/components/data-selector.tsx` | Selector de filtros | **Bug crítico** de mapping |
| `frontend/src/components/energy-chart.tsx` | Orquestador visual | OK pero muy denso |
| `frontend/src/libs/apollo-client.ts` | Cliente Apollo | **Hardcoded URL** |
| `frontend/src/libs/process-generation-data.ts` | Procesamiento agregado | **Dead code comentado** |
| `frontend/src/hooks/useEnergyData.ts`, `useFronteraData.ts` | Hooks GraphQL | OK |

### 🧭 P — Planning (Diagnóstico estratégico)

#### Matriz de hallazgos por severidad

| # | Severidad | Hallazgo | Archivo (estado inicial) |
|---|-----------|----------|--------------------------|
| 🔴 | **Crítico** | Inconsistencia mapping `energyGroups[].id` vs `energyTypes` keys | `data-selector.tsx` |
| 🔴 | **Crítico** | Mutación redundante de query Mongo + `groupType` añadido tarde | `energy-balance.service.ts` |
| 🔴 | **Crítico** | CORS con `origin: '*'` **+** `credentials: true` (combinación inválida por spec) | `main.ts` |
| 🟠 | Alto | URL de Apollo hardcodeada a `http://localhost:3000/graphql` | `apollo-client.ts` |
| 🟠 | Alto | `fetchPolicy: 'no-cache'` para `watchQuery` anula caché de Apollo | `apollo-client.ts` |
| 🟠 | Alto | `groupType` declarado en DTO pero nunca se propagaba al filtro | `energy-balance.input.ts`, `service.ts` |
| 🟡 | Medio | ≈60 líneas de dead code comentado | `process-generation-data.ts` |
| 🟡 | Medio | `.env.example` mínimos (backend) y ausente (frontend) | raíz proyecto |
| 🟡 | Medio | Sin estrategia de TTL/cleanup en Mongo | `app.module.ts` |
| 🟡 | Medio | `console.log` en resolvers de producción | `*.resolver.ts` |
| 🟡 | Medio | Sin tests del flujo crítico (`ReeClientService` sin cobertura) | `test/` |
| 🟢 | Bajo | `return data` cuando Mongoose `.find()` siempre devuelve array (nunca `null`/`undefined`) | `energy-balance.resolver.ts` |
| 🟢 | Bajo | Sin validación de rango máximo de fechas | resolvers |
| 🟢 | Bajo | Mezcla de idiomas en UI (español/inglés) | varios componentes |
| 🟢 | Bajo | `console.debug` ruidoso en `StorageBalance` render | `storage-balance.tsx` |

#### Hallazgos Críticos — Detalle

##### 🔴 Bug #1 — Mapping roto en `DataSelector`

```ts
// ESTADO INICIAL (ANTES de Tier 1)
const energyGroups = [
  { id: 'Renovable', name: 'Renovable' },
  { id: 'No-Renovable', name: 'No renovable' },   // ⚠️ id con guión
];

const energyTypes: EnergyTypes = {
  'Renovable': [...],
  'No renovable': [...],                          // ⚠️ key con espacio
};
```

Cuando el usuario seleccionaba "No renovable":
1. `selectedGroup === 'No-Renovable'` (con guión)
2. `energyTypes['No-Renovable']` → `undefined`
3. El dropdown de tipos secundarios quedaba sin renderizar o vacío.

---

##### 🔴 Bug #2 — Mutación redundante de query Mongo

```ts
// ESTADO INICIAL, líneas ~76-89 de energy-balance.service.ts
const query: FilterQuery<EnergyBalance> = {
  startDate: { $gte: start },
  endDate: { $lte: end },
  ...(groupId && { groupId }),       // spread 1
  ...(type && { type }),
};

this.logger.log(`[3] Query MongoDB: ${JSON.stringify(query)}`);

if (groupId) query.groupId = groupId;       // ⚠️ asignación redundante
if (type) query.type = type;                // ⚠️ asignación redundante
if (groupType) query.groupType = groupType; // ⚠️ añadido fuera del spread
                                            //   y filtra un campo que NO
                                            //   existe a nivel top-level
                                            //   del schema (vive en attributes)
```

**Impacto**: el filtro `groupType` no funcionaba nunca (el schema `EnergyBalance` no tiene `groupType` como propiedad top-level; existe dentro de `attributes`).

---

##### 🔴 Bug #3 — CORS inseguro

```ts
// ESTADO INICIAL, main.ts líneas 5-8
app.enableCors({
  origin: '*',
  credentials: true,   // ⚠️ combinación prohibida por spec CORS
});
```

**Impacto**:
- Los navegadores modernos ignoran la combinación.
- En cualquier caso, expone el endpoint GraphQL a cualquier origen (XSRF, scraping de queries, abuso).

---

### 🛠️ I — Implementation (Plan de mejoras)

#### Tier 1 — Correcciones inmediatas ✅ Aplicado

1. ✅ Alinear `energyTypes` keys con `energyGroups[].id`
2. ✅ Refactor `getBalances` para query declarativa una sola vez
3. ✅ Reemplazar CORS abierto por whitelist vía `CORS_ORIGINS`
4. ✅ Externalizar URL Apollo con `VITE_API_URL`
5. ✅ Crear `backend/.env.example` y `frontend/.env.example` documentados
6. ✅ Crear `frontend/src/vite-env.d.ts` con tipos correctos
7. ✅ Refactorizar `docker-compose.yml` con fallback `${VAR:-default}`

#### Tier 2 — Robustez 🟡 Pendiente

1. Rate limiting con `@nestjs/throttler`
2. Tests unitarios con Vitest para `ReeClientService`
3. Validación de rango de fechas con `@nestjs/class-validator`
4. Estrategia TTL en Mongo (con `mongoose-delete` o índice TTL)
5. Centralizar constantes de `EnergyGroupId` entre front y back
6. Limpiar dead code de `process-generation-data.ts`

#### Tier 3 — Producto 📌 Deseable

1. i18n (es/en) con `react-i18next`
2. Comparativas de periodos (año actual vs anterior)
3. Exportación CSV/JSON
4. PWA para consulta offline
5. Predicción de demanda con tendencia móvil

---

## 5. Estado de Tests (inicial)

### Suite existente `backend/test/`

| Archivo | Tipo | Cobertura | Estado |
|---------|------|-----------|--------|
| `app.controller.spec.ts` | Unit | Smoke del controlador root | Trivial |
| `app.e2e-spec.ts` | E2E | Bootstrap mínimo | Trivial |
| `energy-balance.spec.ts` | Unit | **Incompleta** — sin aserciones reales sobre ReeClientService | Insuficiente |

> **Diagnóstico**: el directorio `test/` da una apariencia de cobertura sin proteger realmente el flujo crítico (`ree-client.service.ts`, `energy-balance.service.ts`, `frontera.service.ts`). Cobertura efectiva estimada: **<10%**.

---

## 6. Calidad de Código (métricas iniciales)

| Métrica | Estado inicial |
|---------|---------------|
| TypeScript strict mode | ❌ No verificable sin compilación (dependencias no instaladas) |
| ESLint configurado | ✅ Sí (`backend/.eslintrc.js`, `frontend/eslint.config.js`) |
| Prettier configurado | ✅ Sí (`backend/.prettierrc`) |
| Tests | 🟡 Cobertura efectiva <10% |
| Dead code | 🟡 ≈60 líneas comentadas |
| Secretos en código | ✅ Ninguno |
| Variables de entorno documentadas | 🟡 `.env.example` rudimentario |
| Validación de inputs | 🟡 Solo chequeo de fechas en resolvers |
| CORS | 🔴 Inseguro |
| Logging | 🟡 Mezcla `console.log` + Nest `Logger` |

---

## 7. Cumplimiento RPI del estado inicial

| Fase RPI | Calificación | Comentario |
|----------|--------------|------------|
| 🔬 **Research** | ✅ Bien | README completo, código legible, servicios bien separados |
| 🧭 **Planning** | 🟡 Mejorable | Faltan tests, fixtures, validaciones, documentar env vars |
| 🛠️ **Implementation** | 🟡 Mejorable | Bugs críticos sin resolver; código tiene debt por dead code |

**Puntuación global del estado inicial**: 6.5 / 10

- Arquitectura sólida y limpia.
- Funciona para los casos felices.
- Riesgo real si se expone a producción sin Tier 1.

---

## 8. Verificación del estado inicial

Para reproducir esta auditoría se aplicó `git status` al inicio de la sesión:

```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

> Este archivo `reporte.md` se generó **después** de aplicar Tier 1, pero su contenido describe exclusivamente el **estado previo**, basándose en las exploraciones de código realizadas durante la fase de Research.

Para comparativa, tras Tier 1:

- `git diff` mostrará los 9 archivos modificados/creados.
- Una auditoría "después" debería complementar este documento (e.g. `reporte-post-tier-1.md`) verificando que: CORS rechaza orígenes desconocidos, `energyTypes[selectedGroup]` siempre resuelve, query Mongo se construye declarativamente, y `VITE_API_URL` se inyecta desde `.env` en build-time.

---

## 9. Conclusiones y Próximos Pasos

### Lo que se hizo bien desde el inicio

- Patrón cache-then-fetch transparente que protege la API pública de REE.
- Separación correcta cliente→servicio→resolver→schema.
- DTOs tipados para GraphQL en backend.
- Estados de UI diferenciados (`LoadingState`, `EnergyErrorState`, etc.).
- Esquema GraphQL auto-generado reduce boilerplate.

### Lo que bloqueaba producción

- 🔴 Bug #1: dropdown de tipos sin segunda fila al elegir "No renovable".
- 🔴 Bug #2: cualquier filtro por `groupType` retornaba `[]`.
- 🔴 Bug #3: cualquier frontend podía consultar el GraphQL sin restricción.

### Próximos pasos recomendados

1. **Inmediato**: Levantar backend+frontend con docker-compose y verificar manualmente que los 3 bugs están resueltos.
2. **Corto plazo** (Tier 2): Tests unitarios del flujo crítico + rate-limiting.
3. **Mediano plazo** (Tier 3): i18n + comparativas.

---

*Documento generado durante el análisis framework **RPI** del proyecto `ree-view`. Estado capturado: pre-Tier-1 (15 de julio de 2026).*
