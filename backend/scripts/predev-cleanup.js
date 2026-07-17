#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Hook automático ejecutado ANTES de `dev` (`nest start --watch`).
 * Libera `:3000` de procesos locales huérfanos de intentos previos.
 *
 * Reglas: solo mata procesos locales node/nest. NO toca Docker. Funciona
 * en Linux (`ss`) y cae a `lsof` en macOS/BSD.
 */

const { execSync } = require('child_process');

const TARGET_PORT = 3000;
const GRACE_MS = 800;

function listPidsOnPort(port) {
  try {
    const ssOut = execSync(
      `ss -ltnp 2>/dev/null | grep -E ':${port}\\b' || true`,
      { encoding: 'utf8' },
    );
    const pids = new Set();
    for (const m of ssOut.matchAll(/pid=(\d+)/g)) pids.add(m[1]);
    if (pids.size > 0) return Array.from(pids);

    const lsofOut = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
      encoding: 'utf8',
    });
    return lsofOut
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getCommander(pid) {
  try {
    return execSync(`ps -o comm= -p ${pid} 2>/dev/null`, {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function isLocalDevProcess(comm) {
  if (!comm) return false;
  const c = comm.toLowerCase();
  return (
    c === 'node' ||
    c === 'node-cli' ||
    c.startsWith('node') ||
    c.includes('nest')
  );
}

function safeKill(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    if (err.code !== 'ESRCH') {
      console.warn(`[predev] could not ${signal} pid=${pid}: ${err.message}`);
    }
    return false;
  }
}

function killWithGrace(pid) {
  if (!safeKill(pid, 'SIGTERM')) return false;
  console.log(`[predev] sent SIGTERM to pid=${pid}; grace ${GRACE_MS}ms`);
  setTimeout(() => {
    try {
      process.kill(pid, 0);
      safeKill(pid, 'SIGKILL');
      console.log(`[predev] escalated to SIGKILL for pid=${pid}`);
    } catch {
      // ya murió
    }
  }, GRACE_MS);
  return true;
}

function main() {
  const startedAt = Date.now();
  const pids = listPidsOnPort(TARGET_PORT);

  if (pids.length === 0) {
    console.log(`[predev] port ${TARGET_PORT} is free; nothing to clean up.`);
    return;
  }

  for (const pid of pids) {
    const comm = getCommander(pid);
    if (isLocalDevProcess(comm)) {
      console.log(
        `[predev] orphan local dev process on :${TARGET_PORT} → ` +
          `pid=${pid} comm="${comm}". Killing...`,
      );
      killWithGrace(pid);
    } else {
      console.log(
        `[predev] port ${TARGET_PORT} held by NON-local pid=${pid} ` +
          `comm="${comm}". Leaving alone. Probably Docker — ` +
          `run \`docker-compose stop backend\` to free it.`,
      );
    }
  }

  console.log(
    `[predev] cleanup phase completed in ${Date.now() - startedAt}ms. ` +
      `Continuing to nest start --watch.`,
  );
}

main();
