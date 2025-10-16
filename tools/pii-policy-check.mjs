#!/usr/bin/env node
import { MongoClient } from 'mongodb';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    json: false,
    limit: 100
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--json':
        args.json = true;
        break;
      case '--limit':
      case '-l':
        args.limit = Number.parseInt(argv[++i], 10) || args.limit;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capsule PII Policy Check\n\nUsage:\n  MONGO_URL=mongodb://... pnpm run check:pii -- [--json] [--limit 100]\n\nFlags:\n  --json        Emit JSON output instead of a console table.\n  --limit, -l   Max flagged memories to print (default 100).\n`);
}

function hasSensitiveFlags(flags) {
  if (!flags || typeof flags !== 'object') {
    return false;
  }
  return Object.values(flags).some(Boolean);
}

async function listViolations(collection, limit) {
  const cursor = collection.find(
    {
      'acl.visibility': { $ne: 'private' }
    },
    {
      projection: {
        content: 0,
        embedding: 0,
        embeddingNorm: 0
      }
    }
  );

  const flagged = [];
  let total = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    total += 1;
    const hasFlags = hasSensitiveFlags(doc.piiFlags);
    const hasCipher = Boolean(doc.piiFlagsCipher);
    if (hasFlags || hasCipher) {
      const subjects = Array.isArray(doc?.acl?.subjects) ? doc.acl.subjects : [];
      flagged.push({
        id: doc._id?.toString(),
        visibility: doc?.acl?.visibility ?? 'unknown',
        subjects,
        piiFlags: doc.piiFlags,
        piiFlagsCipher: hasCipher,
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt
      });
      if (flagged.length >= limit) {
        break;
      }
    }
  }

  return { totalChecked: total, flagged };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const mongoUrl = requireEnv('MONGO_URL');
  const client = new MongoClient(mongoUrl, { maxPoolSize: 5 });

  try {
    await client.connect();
    const url = new URL(mongoUrl.replace('mongodb+srv://', 'mongodb://'));
    const dbName = process.env.MONGO_DB ?? url.pathname.replace(/\//g, '') || 'capsule-memory';
    const db = client.db(dbName);
    const collection = db.collection('memories');

    const { totalChecked, flagged } = await listViolations(collection, args.limit);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            totalChecked,
            flaggedCount: flagged.length,
            flagged
          },
          null,
          2
        )
      );
    } else {
      console.log(`Checked ${totalChecked} shared/public memories. Flagged ${flagged.length}.`);
      if (flagged.length > 0) {
        console.table(
          flagged.map((doc) => ({
            id: doc.id,
            visibility: doc.visibility,
            subjects: doc.subjects?.join(', ') ?? '—',
            hasCipher: doc.piiFlagsCipher ? 'yes' : 'no',
            piiFlags: doc.piiFlags ? JSON.stringify(doc.piiFlags) : '—',
            updatedAt: doc.updatedAt ?? '—'
          }))
        );
        console.log('❗ Resolve by clearing PII flags or reverting visibility to private.');
      } else {
        console.log('✅ No PII policy violations detected.');
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('PII policy check failed:', error.message ?? error);
  process.exit(1);
});
