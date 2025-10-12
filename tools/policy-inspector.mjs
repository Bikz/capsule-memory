#!/usr/bin/env node
import { STORAGE_POLICIES } from './backfill-metadata.mjs';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

const fallback = {
  name: 'default',
  description: 'Fallback policy when no other matcher applies.',
  store: 'long_term',
  ttlSeconds: undefined,
  graphEnrich: false,
  dedupeThreshold: undefined,
  importanceScore: undefined,
  notes: ''
};

const rows = [fallback, ...STORAGE_POLICIES.map((policy) => {
  const summary = policy.summary ?? {};
  return {
    name: policy.name,
    description: policy.description ?? '',
    store: summary.store ?? 'long_term',
    ttlSeconds: summary.ttlSeconds,
    graphEnrich: summary.graphEnrich ?? false,
    dedupeThreshold: summary.dedupeThreshold,
    importanceScore: summary.importanceScore,
    notes: summary.notes ?? (policy.name === 'knowledge-connectors-long-term' ? 'source.connector ∈ {notion, drive}' : '')
  };
})];

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.table(
    rows.map((row) => ({
      Policy: row.name,
      Description: row.description,
      Store: row.store,
      TTL: row.ttlSeconds === null ? '∞' : row.ttlSeconds ?? '—',
      'Graph Enrich': row.graphEnrich ? 'yes' : 'no',
      'Dedupe ≥': row.dedupeThreshold ?? '—',
      'Importance Boost': row.importanceScore ?? '—',
      Notes: row.notes ?? ''
    }))
  );
}
