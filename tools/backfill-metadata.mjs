#!/usr/bin/env node
import { MongoClient } from 'mongodb';

const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.BACKFILL_BATCH_SIZE ?? '50', 10);

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run') || args.has('-d');
const verbose = args.has('--verbose') || args.has('-v');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const STORAGE_POLICIES = [
  {
    name: 'preferences-long-term',
    match: (context) => context.type === 'preference',
    summary: {
      store: 'long_term',
      ttlSeconds: null,
      dedupeThreshold: 0.9,
      importanceScore: 1.5
    },
    apply: () => ({ store: 'long_term', ttlSeconds: null, dedupeThreshold: 0.9, importanceScore: 1.5 })
  },
  {
    name: 'operational-logs-short-term',
    match: (context) => context.type === 'log',
    summary: {
      store: 'short_term',
      ttlSeconds: 60 * 60 * 24 * 14,
      graphEnrich: false
    },
    apply: () => ({ store: 'short_term', ttlSeconds: 60 * 60 * 24 * 14, graphEnrich: false })
  },
  {
    name: 'knowledge-connectors-long-term',
    match: (context) =>
      Boolean(context.source?.connector && ['notion', 'drive'].includes(context.source.connector)),
    summary: {
      store: 'long_term',
      graphEnrich: true
    },
    apply: () => ({ store: 'long_term', graphEnrich: true })
  }
];

function resolveLanguage(content, provided) {
  const normalized = (provided ?? '').trim().toLowerCase();
  if (normalized) return normalized;
  if (!content) return 'und';
  const asciiMatches = content.match(/[A-Za-z0-9\s,\.\?\!\-\(\)'\"]+/g);
  const asciiLength = asciiMatches?.join('').length ?? 0;
  const ratio = asciiLength / content.length;
  if (ratio >= 0.75) return 'en';
  return 'und';
}

function resolveAcl(acl) {
  if (acl && typeof acl === 'object' && acl.visibility) {
    return { visibility: acl.visibility };
  }
  return { visibility: 'private' };
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return undefined;
  const unique = Array.from(new Set(tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

function computeImportance(pinned, provided) {
  if (Number.isFinite(provided)) {
    return Math.max(0, Math.min(Number(provided), 5));
  }
  return pinned ? 1.5 : 1;
}

function computeRecency(provided) {
  if (Number.isFinite(provided)) {
    return Math.max(0, Math.min(Number(provided), 5));
  }
  return 1;
}

function evaluatePolicies(context) {
  const aggregate = { store: 'long_term' };
  const applied = [];
  for (const policy of STORAGE_POLICIES) {
    if (policy.match(context)) {
      applied.push(policy.name);
      const effect = policy.apply(context);
      if (Object.prototype.hasOwnProperty.call(effect, 'ttlSeconds')) {
        aggregate.ttlSeconds = effect.ttlSeconds;
      }
      if (effect.store) {
        aggregate.store = effect.store;
      }
      if (Object.prototype.hasOwnProperty.call(effect, 'graphEnrich')) {
        aggregate.graphEnrich = effect.graphEnrich;
      }
      if (typeof effect.dedupeThreshold === 'number') {
        aggregate.dedupeThreshold = effect.dedupeThreshold;
      }
      if (typeof effect.importanceScore === 'number') {
        aggregate.importanceScore = effect.importanceScore;
      }
    }
  }
  return { ...aggregate, appliedPolicies: applied };
}

function computeTtlSeconds(doc) {
  if (Number.isFinite(doc.ttlSeconds)) {
    return doc.ttlSeconds;
  }
  if (doc.expiresAt instanceof Date || typeof doc.expiresAt === 'string') {
    const expiresAt = new Date(doc.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && doc.createdAt) {
      const created = new Date(doc.createdAt);
      const diff = Math.max(0, Math.round((expiresAt.getTime() - created.getTime()) / 1000));
      return diff > 0 ? diff : undefined;
    }
  }
  return undefined;
}

function buildProvenance(doc) {
  const entry = {
    event: 'backfill',
    at: new Date(),
    actor: 'capsule-backfill',
    description: 'Populated CapsuleMeta defaults'
  };
  if (!Array.isArray(doc.provenance) || doc.provenance.length === 0) {
    return { set: [entry] };
  }
  return { push: entry };
}

async function backfill() {
  const mongoUrl = requireEnv('MONGO_URL');
  const client = new MongoClient(mongoUrl, { maxPoolSize: 5 });
  const batchSize = Number.isFinite(DEFAULT_BATCH_SIZE) ? DEFAULT_BATCH_SIZE : 50;

  try {
    await client.connect();
    const url = new URL(mongoUrl.replace('mongodb+srv://', 'mongodb://'));
    const dbName = process.env.MONGO_DB ?? url.pathname.replace(/\//g, '') || 'capsule-memory';
    const db = client.db(dbName);
    const collection = db.collection('memories');

    const cursor = collection.find({});

    let processed = 0;
    let updated = 0;

    const bulkOps = [];

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      processed += 1;

      const set = {};
      const unset = {};
      const push = {};

      const lang = resolveLanguage(doc.content ?? '', doc.lang);
      if (doc.lang !== lang) {
        set.lang = lang;
      }

      const acl = resolveAcl(doc.acl);
      if (!doc.acl || doc.acl.visibility !== acl.visibility) {
        set.acl = acl;
      }

      const importanceScore = computeImportance(Boolean(doc.pinned), doc.importanceScore);
      if (!Number.isFinite(doc.importanceScore) || doc.importanceScore !== importanceScore) {
        set.importanceScore = importanceScore;
      }

      const recencyScore = computeRecency(doc.recencyScore);
      if (!Number.isFinite(doc.recencyScore) || doc.recencyScore !== recencyScore) {
        set.recencyScore = recencyScore;
      }

      const tags = sanitizeTags(doc.tags);
      if (tags && JSON.stringify(tags) !== JSON.stringify(doc.tags)) {
        set.tags = tags;
      }

      const ttlSeconds = computeTtlSeconds(doc);
      if (ttlSeconds === undefined && doc.ttlSeconds !== undefined) {
        unset.ttlSeconds = '';
      } else if (ttlSeconds !== undefined && doc.ttlSeconds !== ttlSeconds) {
        set.ttlSeconds = ttlSeconds;
        if (!doc.expiresAt && doc.createdAt) {
          const created = new Date(doc.createdAt);
          const expiresAt = new Date(created.getTime() + ttlSeconds * 1000);
          set.expiresAt = expiresAt;
        }
      }

      if (!doc.embeddingModel) {
        set.embeddingModel = doc.embeddingModel ?? 'unknown';
      }

      if (!doc.storage) {
        const policyResult = evaluatePolicies({
          type: doc.type,
          source: doc.source,
          tags,
          pinned: Boolean(doc.pinned)
        });
        const storage = {
          store: policyResult.store ?? 'long_term',
          policies: policyResult.appliedPolicies,
          ...(typeof policyResult.dedupeThreshold === 'number'
            ? { dedupeThreshold: policyResult.dedupeThreshold }
            : {})
        };
        set.storage = storage;
        if (typeof policyResult.graphEnrich === 'boolean') {
          set.graphEnrich = policyResult.graphEnrich;
        }
        if (typeof policyResult.importanceScore === 'number' && !set.importanceScore) {
          set.importanceScore = computeImportance(Boolean(doc.pinned), policyResult.importanceScore);
        }
      } else if (typeof doc.graphEnrich !== 'boolean') {
        set.graphEnrich = Boolean(doc.storage?.graphEnrich);
      }

      if (!doc.updatedAt) {
        set.updatedAt = new Date();
      }

      const provenance = buildProvenance(doc);
      if (provenance.set) {
        set.provenance = provenance.set;
      } else if (provenance.push) {
        push.provenance = provenance.push;
      }

      if (Object.keys(set).length || Object.keys(unset).length || Object.keys(push).length) {
        updated += 1;
        if (verbose) {
          console.log(`Updating memory ${doc._id.toString()} with`, { set, unset, push });
        }
        if (!isDryRun) {
          const update = {};
          if (Object.keys(set).length) update.$set = set;
          if (Object.keys(unset).length) update.$unset = unset;
          if (Object.keys(push).length) update.$push = push;
          bulkOps.push({ updateOne: { filter: { _id: doc._id }, update } });
        }
      }

      if (bulkOps.length >= batchSize && !isDryRun) {
        await collection.bulkWrite(bulkOps, { ordered: false });
        bulkOps.length = 0;
      }
    }

    if (bulkOps.length && !isDryRun) {
      await collection.bulkWrite(bulkOps, { ordered: false });
    }

    console.log(`Backfill complete. Processed ${processed} memories; ${updated} updated${isDryRun ? ' (dry run)' : ''}.`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

backfill().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
