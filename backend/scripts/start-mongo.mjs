// Bootstrap:
// Arranca una instancia de MongoDB en memoria con mongodb-memory-server,
// imprime la URI con prefijo "URI:" para que se pueda extraer fácilmente
// desde logs, y mantiene el proceso vivo hasta SIGINT/SIGTERM.
//
// Configurable vía:
//   MONGO_VERSION=7.0.14   (default)
//   MONGO_DB=energy-balance (default)
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create({
  instance: { dbName: process.env.MONGO_DB || 'energy-balance' },
  binary: { version: process.env.MONGO_VERSION || '7.0.14' },
});

console.log('URI:' + mongod.getUri());

// Mantener vivo
process.stdin.resume();

const shutdown = async () => {
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await new Promise(() => {});
