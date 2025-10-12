import { CapsuleSource, StorageDestination } from './meta';

export type StoragePolicyContext = {
  type?: string;
  source?: CapsuleSource;
  tags?: string[];
  pinned?: boolean;
};

export type StoragePolicyEffect = {
  ttlSeconds?: number | null;
  store?: StorageDestination;
  graphEnrich?: boolean;
  dedupeThreshold?: number;
  importanceScore?: number;
};

export type StoragePolicy = {
  name: string;
  description?: string;
  summary?: {
    store?: StorageDestination;
    ttlSeconds?: number | null;
    graphEnrich?: boolean;
    dedupeThreshold?: number;
    importanceScore?: number;
    notes?: string;
  };
  match: (context: StoragePolicyContext) => boolean;
  apply: (context: StoragePolicyContext) => StoragePolicyEffect;
};

export type StoragePolicyResult = StoragePolicyEffect & {
  appliedPolicies: string[];
};

function mergeEffects(target: StoragePolicyEffect, effect: StoragePolicyEffect) {
  if ('ttlSeconds' in effect) {
    target.ttlSeconds = effect.ttlSeconds ?? null;
  }
  if (effect.store) {
    target.store = effect.store;
  }
  if ('graphEnrich' in effect) {
    target.graphEnrich = effect.graphEnrich;
  }
  if (typeof effect.dedupeThreshold === 'number') {
    target.dedupeThreshold = effect.dedupeThreshold;
  }
  if (typeof effect.importanceScore === 'number') {
    target.importanceScore = effect.importanceScore;
  }
}

export function evaluateStoragePolicies(
  context: StoragePolicyContext,
  policies: StoragePolicy[]
): StoragePolicyResult {
  const aggregate: StoragePolicyEffect = { store: 'long_term' };
  const appliedPolicies: string[] = [];

  for (const policy of policies) {
    if (policy.match(context)) {
      appliedPolicies.push(policy.name);
      const effect = policy.apply(context);
      mergeEffects(aggregate, effect);
    }
  }

  return {
    ...aggregate,
    appliedPolicies
  };
}

const CONNECTOR_LONG_TERM = new Set(['notion', 'drive']);

export const defaultStoragePolicies: StoragePolicy[] = [
  {
    name: 'preferences-long-term',
    description: 'Keep user preferences indefinitely in the long-term store with dedupe hints.',
    summary: {
      store: 'long_term',
      ttlSeconds: null,
      dedupeThreshold: 0.9,
      importanceScore: 1.5
    },
    match: (context) => context.type === 'preference',
    apply: () => ({
      store: 'long_term',
      ttlSeconds: null,
      dedupeThreshold: 0.9,
      importanceScore: 1.5
    })
  },
  {
    name: 'operational-logs-short-term',
    description: 'Short-lived operational logs flow to the ring buffer.',
    summary: {
      store: 'short_term',
      ttlSeconds: 60 * 60 * 24 * 14,
      graphEnrich: false
    },
    match: (context) => context.type === 'log',
    apply: () => ({
      store: 'short_term',
      ttlSeconds: 60 * 60 * 24 * 14,
      graphEnrich: false
    })
  },
  {
    name: 'knowledge-connectors-long-term',
    description: 'Connector sourced docs default to long-term store with graph enrichment.',
    summary: {
      store: 'long_term',
      graphEnrich: true,
      notes: 'Triggers when source.connector ∈ {notion, drive}'
    },
    match: (context) =>
      Boolean(context.source?.connector && CONNECTOR_LONG_TERM.has(context.source.connector)),
    apply: () => ({
      store: 'long_term',
      graphEnrich: true
    })
  }
];

export type StoragePolicySummary = {
  name: string;
  description?: string;
  defaults?: StoragePolicy['summary'];
};

export function listStoragePolicySummaries(): StoragePolicySummary[] {
  const basePolicy: StoragePolicySummary = {
    name: 'default',
    description: 'Fallback policy when no specific matcher triggers.',
    defaults: {
      store: 'long_term',
      ttlSeconds: undefined,
      graphEnrich: false
    }
  };

  return [
    basePolicy,
    ...defaultStoragePolicies.map((policy) => ({
      name: policy.name,
      description: policy.description,
      defaults: policy.summary
    }))
  ];
}
