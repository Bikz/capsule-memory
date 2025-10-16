import { z } from 'zod';

import { jsonServiceFetch } from './serviceClient';

type Candidate = {
  id: string;
  content: string;
  score: number;
};

const responseSchema = z.object({
  ranked: z.array(
    z.object({
      id: z.string(),
      score: z.number()
    })
  )
});

export async function rerankCandidates(params: {
  prompt: string;
  query: string;
  candidates: Candidate[];
}): Promise<{ candidates: Candidate[]; latencyMs: number; applied: boolean }> {
  const endpoint = process.env.CAPSULE_RERANKER_URL;
  if (!endpoint) {
    return { candidates: params.candidates, latencyMs: 0, applied: false };
  }

  const key = process.env.CAPSULE_RERANKER_KEY;
  const result = await jsonServiceFetch(endpoint, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    body: {
      prompt: params.prompt,
      query: params.query,
      candidates: params.candidates
    }
  });

  if (!result.ok || !result.data) {
    return { candidates: params.candidates, latencyMs: result.latencyMs, applied: false };
  }

  const parsed = responseSchema.safeParse(result.data);
  if (!parsed.success) {
    return { candidates: params.candidates, latencyMs: result.latencyMs, applied: false };
  }

  const scoreMap = new Map(parsed.data.ranked.map((item) => [item.id, item.score]));
  const ranked = params.candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreMap.get(candidate.id) ?? candidate.score
    }))
    .sort((a, b) => b.score - a.score);

  return { candidates: ranked, latencyMs: result.latencyMs, applied: true };
}
