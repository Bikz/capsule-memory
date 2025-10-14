import { CapsuleRetention, CapsuleStorageState } from './meta';

export type SearchRecipeName =
  | 'default-semantic'
  | 'conversation-memory'
  | 'knowledge-qa'
  | 'audit-trace';

export type SearchRecipeScoring = {
  semanticWeight: number;
  importanceWeight?: number;
  recencyWeight?: number;
  pinnedBoost?: number;
  retentionBoosts?: Partial<Record<CapsuleRetention, number>>;
};

export type SearchRecipeFilters = {
  pinnedOnly?: boolean;
  graphEnrich?: boolean;
  types?: string[];
};

export type SearchRecipe = {
  name: SearchRecipeName;
  label: string;
  description: string;
  limit: number;
  candidateLimit: number;
  filters?: SearchRecipeFilters;
  scoring: SearchRecipeScoring;
  graphExpand?: {
    limit: number;
    depth?: number;
  };
};

const recipes: Record<SearchRecipeName, SearchRecipe> = {
  'default-semantic': {
    name: 'default-semantic',
    label: 'Default Semantic',
    description: 'Balanced semantic retrieval with light importance and recency boosts.',
    limit: 10,
    candidateLimit: 400,
    scoring: {
      semanticWeight: 1,
      importanceWeight: 0.1,
      recencyWeight: 0.05,
      pinnedBoost: 0.15,
      retentionBoosts: {
        irreplaceable: 0.25,
        permanent: 0.15
      }
    }
  },
  'conversation-memory': {
    name: 'conversation-memory',
    label: 'Conversation Memory',
    description: 'Prefers pinned and recent memories for dialog grounding (small k).',
    limit: 5,
    candidateLimit: 200,
    filters: {
      pinnedOnly: false
    },
    scoring: {
      semanticWeight: 1,
      importanceWeight: 0.15,
      recencyWeight: 0.3,
      pinnedBoost: 0.4,
      retentionBoosts: {
        irreplaceable: 0.35,
        permanent: 0.2,
        replaceable: 0.05
      }
    }
  },
  'knowledge-qa': {
    name: 'knowledge-qa',
    label: 'Knowledge QA',
    description: 'Higher k with graph-enriched sources for multi-hop answers.',
    limit: 15,
    candidateLimit: 500,
    filters: {
      graphEnrich: true
    },
    graphExpand: {
      limit: 10,
      depth: 1
    },
    scoring: {
      semanticWeight: 1,
      importanceWeight: 0.2,
      recencyWeight: 0.1,
      pinnedBoost: 0.1,
      retentionBoosts: {
        irreplaceable: 0.2,
        permanent: 0.1
      }
    }
  },
  'audit-trace': {
    name: 'audit-trace',
    label: 'Audit Trace',
    description: 'Focuses on operational logs and provenance-heavy memories.',
    limit: 20,
    candidateLimit: 500,
    filters: {
      types: ['log', 'audit']
    },
    scoring: {
      semanticWeight: 1,
      importanceWeight: 0.05,
      recencyWeight: 0.15,
      pinnedBoost: 0.05,
      retentionBoosts: {
        permanent: 0.1
      }
    }
  }
};

export function getSearchRecipe(name?: string | null): SearchRecipe {
  if (name && name in recipes) {
    return recipes[name as SearchRecipeName];
  }
  return recipes['default-semantic'];
}

export function listSearchRecipes(): SearchRecipe[] {
  return Object.values(recipes);
}

export function describeRecipeMatch(filters: SearchRecipeFilters | undefined) {
  if (!filters) {
    return 'all memories';
  }
  const clauses: string[] = [];
  if (filters.pinnedOnly) {
    clauses.push('pinned memories');
  }
  if (filters.graphEnrich) {
    clauses.push('graph-enriched sources');
  }
  if (filters.types && filters.types.length > 0) {
    clauses.push(`types: ${filters.types.join(', ')}`);
  }
  return clauses.length > 0 ? clauses.join(' and ') : 'all memories';
}

export type RecipeContext = {
  storage?: CapsuleStorageState;
  pinned: boolean;
  importanceScore?: number;
  recencyScore?: number;
  retention?: CapsuleRetention;
};

export function applyRecipeWeight(
  baseScore: number,
  context: RecipeContext,
  scoring: SearchRecipeScoring
): number {
  const importance = context.importanceScore ?? 1;
  const recency = context.recencyScore ?? 1;
  let score = baseScore * scoring.semanticWeight;
  if (scoring.importanceWeight) {
    score += importance * scoring.importanceWeight;
  }
  if (scoring.recencyWeight) {
    score += recency * scoring.recencyWeight;
  }
  if (scoring.pinnedBoost && context.pinned) {
    score += scoring.pinnedBoost;
  }
  if (scoring.retentionBoosts && context.retention) {
    const boost = scoring.retentionBoosts[context.retention];
    if (typeof boost === 'number') {
      score += boost;
    }
  }
  return score;
}
