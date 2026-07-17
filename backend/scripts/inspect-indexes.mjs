import { MongoClient } from 'mongodb';

const uri = process.argv[2];
if (!uri) {
  console.error('Uso: inspect-indexes.mjs <mongodb-uri>');
  process.exit(1);
}

const client = new MongoClient(uri, {
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
