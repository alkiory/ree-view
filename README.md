# Ree View — Balance Eléctrico Nacional

Visualizador fullstack del **balance eléctrico del sistema eléctrico nacional español**, alimentado en tiempo real por la API pública de [REE (Red Eléctrica de España)](https://apidatos.ree.es/).

Permite explorar **generación por tecnología**, **demanda**, **intercambios internacionales en fronteras** y **balance de almacenamiento**, filtrando por **rango de fechas** y **tipo de energía** (renovable vs. no-renovable).

<p align="center">
  <img src="https://img.shields.io/github/last-commit/SergioCampbell/ree-view?style=flat-square" alt="Último commit"/>
  <img src="https://img.shields.io/github/repo-size/SergioCampbell/ree-view?style=flat-square" alt="Tamaño del repo"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19"/>
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 6"/>
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS 10"/>
  <img src="https://img.shields.io/badge/GraphQL-E10098?style=for-the-badge&logo=graphql&logoColor=white" alt="GraphQL"/>
  <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB 6"/>
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS 4"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>
  <img src="https://img.shields.io/badge/License-UNLICENSED-red?style=for-the-badge" alt="License: UNLICENSED"/>
</p>

![alt text](image-2.png)

---

## 🧱 Stack

### Frontend (`frontend/`)
- **React 19** + **Vite 6**
- **TypeScript**
- **Apollo Client** (GraphQL)
- **Tailwind CSS 4** + **recharts** (gráficos)
- **react-datepicker**

### Backend (`backend/`)
- **NestJS 10** + **GraphQL (Apollo Server)**
- **Mongoose** + **MongoDB 6.0** (caché de respuestas REE)
- **Axios** (cliente HTTP a REE)
- **@nestjs/throttler** (rate-limiting)
- **class-validator** + **class-transformer** (validación de inputs)

### Infraestructura
- **Docker Compose** con 3 servicios: `backend`, `frontend`, `mongo`
- **Nginx** en el contenedor del frontend (sirve el build estático de Vite)

---

## 🏃 Desarrollo local (sin Docker)

### Requisitos
- **Node.js** ≥ 20
- **pnpm** ≥ 10
- MongoDB local en el puerto `27017` (o cualquier URI configurable vía `.env`)

### 1. Backend
```bash
cd backend
cp .env.example .env       # ajusta REE_API_URL, MONGODB_URI, CORS_ORIGINS...
pnpm install
pnpm run dev               # http://localhost:3000/graphql
```

### 2. Frontend
```bash
cd frontend
cp .env.example .env       # VITE_API_URL=http://localhost:3000/graphql
pnpm install
pnpm run dev               # http://localhost:5173
```

Abre `http://localhost:5173` y selecciona un rango de fechas para empezar a explorar datos.

---

## 🐳 Despliegue con Docker

Levanta los tres servicios (backend + frontend + Mongo) en un solo comando:

```bash
# Desde la raíz del proyecto
docker-compose up -d --build
```

| Servicio  | URL                          | Notas                                  |
|-----------|------------------------------|----------------------------------------|
| Frontend  | http://localhost:80          | Servido por Nginx                      |
| Backend   | http://localhost:3000/graphql | GraphQL Playground disponible         |
| MongoDB   | `mongodb://localhost:27017`  | DB `energy-balance`, volumen persistente |

### Variables de entorno relevantes
- `CORS_ORIGINS` — whitelist de orígenes permitidos (separados por coma)
- `MONGODB_URI` — conexión a Mongo (por defecto usa el contenedor `mongo`)
- `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` — rate-limit global del GraphQL
- `VITE_API_URL` — endpoint que consumirá el frontend (injected at build time)

### Verificación end-to-end

Tras levantar el stack, ejecuta el script de smoke test:

```bash
chmod +x verify-stack.sh
./verify-stack.sh
```

Pasa por las **6 fases** críticas: stack-up, los 3 resolvers GraphQL, rate-limiting y TTL en MongoDB.

### Comandos útiles
```bash
docker-compose ps                  # estado de los servicios
docker-compose logs -f backend     # logs en vivo
docker-compose down                # detener todo
docker-compose down -v             # detener + borrar volumen de Mongo
```

---

## 🗂️ Estructura del proyecto

```
ree-view/
├── backend/                # NestJS + GraphQL + Mongo
│   ├── src/energy-balance/ # Módulo principal del dominio
│   └── test/              # Tests (Jest + Vitest)
├── frontend/               # React + Vite + Apollo
│   └── src/components/    # Cards: generación, demanda, fronteras, storage
├── docker-compose.yml      # Stack completo (backend + frontend + mongo)
├── verify-stack.sh         # Smoke test automatizado (6 fases)
└── reporte.md              # Auditoría inicial del proyecto
└── reporte-post-stack.md   # Verificación final del stack
```

---

## 🧪 Tests

```bash
# Backend (Jest + Vitest)
cd backend
pnpm run test           # Jest: smoke tests + integración
pnpm run test:vitest    # Vitest: ReeClientService (happy + error paths)
pnpm run test:all       # todo junto

# Frontend (Vitest)
cd frontend
pnpm run test:vitest
```

---

## 📐 Características principales

- 🗓️ **Filtros**: rango de fechas, grupo energético (renovable/no-renovable) y tipo de energía.
- 📊 **Generación**: desglose por tecnología (eólica, solar, hidráulica, nuclear, gas, etc.) con totales y porcentajes.
- ⚡ **Demanda**: demanda promedio del sistema.
- 🌍 **Fronteras**: intercambios internacionales con Portugal, Francia, Andorra y Marruecos.
- 💾 **Almacenamiento**: balance de almacenamiento (bombeo y baterías).
- 🌓 **Tema claro/oscuro** con soporte nativo vía design tokens.
- 🚦 **Resiliencia**: rate-limiting, validación de fechas, caché TTL de 24h en Mongo, fallback mock en dev.

---

*Hecho con fines educativos/demostrativos sobre la API pública de REE. No afiliado a Red Eléctrica de España.*
