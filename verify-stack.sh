#!/usr/bin/env bash
# =============================================================================
# verify-stack.sh — Verificación end-to-end del stack ree-view
#
# USO:
#   chmod +x verify-stack.sh && ./verify-stack.sh
#
# PRERREQUISITOS (en la máquina destino):
#   - Docker + docker-compose (v1) o `docker compose` (v2)
#   - curl
#
# Este script asume que estás en la raíz del proyecto (ree-view) donde está
# el `docker-compose.yml` raíz.
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

OK="✅"
FAIL="❌"
PHASE="▶"

echo "${PHASE} PHASE 1/6: Levantar el stack con docker-compose"
docker-compose up -d --build

# --- Wait explícito para Mongo (es independiente) ---
echo "${PHASE} Esperando Mongo (acepta ping)..."
for i in {1..30}; do
  if docker-compose exec -T mongo mongosh --quiet --eval 'db.adminCommand({ping:1})' >/dev/null 2>&1; then
    echo "${OK} Mongo listo"
    break
  fi
  sleep 2
done

# --- Wait backend ---
echo "${PHASE} Esperando backend en http://localhost:3000/graphql..."
for i in {1..90}; do
  if curl -fsS http://localhost:3000/graphql \
       -H 'Content-Type: application/json' \
       -d '{"query":"{__typename}"}' >/dev/null 2>&1; then
    echo "${OK} backend listo"
    break
  fi
  sleep 2
done

# --- Wait frontend ---
echo "${PHASE} Esperando frontend en http://localhost:80..."
for i in {1..30}; do
  if curl -fsS http://localhost:80/ -o /dev/null 2>&1; then
    echo "${OK} frontend listo"
    break
  fi
  sleep 2
done

# --- Containers sanity ---
echo "${PHASE} Verificando contenedores"
docker-compose ps
RUNNING=$(docker-compose ps --services --filter "status=running" 2>/dev/null | wc -l | tr -d ' ')
test "${RUNNING}" -eq 3 && echo "${OK} 3 contenedores corriendo" \
  || { echo "${FAIL} sólo ${RUNNING} contenedores corriendo (esperado 3)"; exit 1; }

echo ""
echo "${PHASE} PHASE 2/6: Resolver 1/3 — getEnergyBalances"
RES1=$(curl -fsS http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query{getEnergyBalances(input:{startDate:\"2025-04-15\",endDate:\"2025-04-15\"}){type groupId attributes{title total}}}"}')
echo "${RES1:0:500}..."

echo ""
echo "${PHASE} PHASE 3/6: Resolver 2/3 — getIntercambios"
RES2=$(curl -fsS http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query{getIntercambios(input:{startDate:\"2024-10-19\",endDate:\"2024-10-19\"}){type groupId country attributes{total}}}"}')
echo "${RES2:0:500}..."

echo ""
echo "${PHASE} PHASE 4/6: Resolver 3/3 — ree-client REST (rate-limited debug)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/ree-client \
  -H 'Content-Type: application/json' \
  -d '{"start":"2025-04-20T00:00:00Z","end":"2025-04-20T23:59:59Z"}')
echo "HTTP ${CODE} (esperado 200 si no se ha agotado DEBUG_THROTTLE_LIMIT)"

echo ""
echo "${PHASE} PHASE 5/6: Throttling — 40 req al /graphql (esperado ~10 con 429)"
MAP=$(for i in {1..40}; do
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/graphql \
    -H 'Content-Type: application/json' \
    -d '{"query":"{__typename}"}'
done | sort | uniq -c)
echo "${MAP}"

NB429=$(for i in {1..40}; do
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/graphql \
    -H 'Content-Type: application/json' \
    -d '{"query":"{__typename}"}'
done | grep -c '^429' || true)
echo "${OK} 429 responses: ${NB429} (esperado en rango 5–15 con THROTTLE_LIMIT=30)"

if [[ ${NB429} -ge 5 && ${NB429} -le 15 ]]; then
  echo "${OK} Throttling dentro del rango esperado"
else
  echo "${FAIL} Throttling fuera del rango esperado"
fi

echo ""
echo "${PHASE} PHASE 6/6: TTL en MongoDB"
# Uso `docker exec -i` (sin -t) porque sin TTY el heredoc se evalúa
docker-compose exec -i mongo mongosh --quiet <<'MONGO_JS'
db.getSiblingDB("energy-balance").energybalances.getIndexes().forEach(i =>
  print(JSON.stringify({name:i.name, key:i.key, ttl:i.expireAfterSeconds || null})));
print("--- fronteras ---");
db.getSiblingDB("energy-balance").fronteras.getIndexes().forEach(i =>
  print(JSON.stringify({name:i.name, key:i.key, ttl:i.expireAfterSeconds || null})));
MONGO_JS

echo ""
echo "${OK} Verificación completada"
echo "Para detener el stack: docker-compose down"
echo "Para ver logs del backend en vivo: docker-compose logs -f backend"
