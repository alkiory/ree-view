// Inspecciona los índices de las colecciones energybalances y fronteras
// para confirmar que el TTL (expireAfterSeconds) está activo.
//
// Uso: node inspect-indexes.mjs <mongodb-uri>
import { MongoClient } from 'mongodb';

const uri = process.argv[2];
if (!uri) {
  console.error('Uso: inspect-indexes.mjs <mongodb-uri>');
  process.exit(1);
}

const client = new MongoClient(uri, {
  // Evita que la conexión quede colgada si Mongo no responde
  serverSelectionTimeoutMS: 5_000,
});
await client.connect();

for (const name of ['energybalances', 'fronteras']) {
  console.log(`\n== ${name} ==`);
  try {
    const indexes = await client
      .db(process.env.MONGO_DB || 'energy-balance')
      .collection(name)
      .indexes();
    for (const idx of indexes) {
      const ttl = idx.expireAfterSeconds ?? 'no-ttl';
      console.log(
        JSON.stringify({ name: idx.name, key: idx.key, expireAfterSeconds: ttl }),
      );
    }
  } catch (e) {
    console.log(`  (no collection or error: ${e.message})`);
  }
}

await client.close();
