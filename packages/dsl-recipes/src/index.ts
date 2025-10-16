export type RecipeStep =
  | { kind: 'embed'; model: string; mode?: 'query' | 'doc' }
  | { kind: 'vector_search'; k: number; store: string }
  | { kind: 'keyword_bm25'; k: number; fields?: string[] }
  | { kind: 'merge'; strategy?: 'union' | 'intersect' }
  | { kind: 'rerank'; model: string; top_k?: number }
  | { kind: 'boosts'; recency_half_life_days?: number; pinned_weight?: number }
  | { kind: 'filter'; where?: Record<string, unknown> }
  | { kind: 'graph_expand'; hops?: number }
  | { kind: 'return'; k: number; include?: string[] };

export interface Recipe {
  version: 1;
  name: string;
  steps: RecipeStep[];
}

export const DEFAULT_SEMANTIC: Recipe = {
  version: 1,
  name: 'default-semantic',
  steps: [
    { kind: 'embed', model: 'voyage-3.5', mode: 'query' },
    { kind: 'vector_search', k: 50, store: 'default' },
    { kind: 'merge', strategy: 'union' },
    { kind: 'rerank', model: 'cross-encoder', top_k: 10 },
    { kind: 'boosts', recency_half_life_days: 14, pinned_weight: 2.0 },
    {
      kind: 'return',
      k: 5,
      include: ['content', 'score', 'createdAt', 'source', 'explanation']
    }
  ]
};
