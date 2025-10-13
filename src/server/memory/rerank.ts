import { z } from 'zod';

const responseSchema = z.object({
  ranked: z.array(
    z.object({
      id: z.string(),
      score: z.number()
    })
  )
});

async function callReranker(prompt: string, query: string, candidates: { id: string; content: string; score: number }[]) {
  const url = process.env.CAPSULE_RERANKER_URL;
  if (!url) {
    return null;
  }
  const key = process.env.CAPSULE_RERANKER_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {})
    },
    body: JSON.stringify({ prompt, query, candidates })
  });
  if (!res.ok) {
    console.warn('[Capsule] Reranker request failed:', res.status, await res.text());
    return null;
  }
  const payload = await res.json();
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.ranked;
}

export async function rerankCandidates(params: {
  prompt: string;
  query: string;
  candidates: Array<{ id: string; content: string; score: number }>;
}) {
  const reranked = await callReranker(params.prompt, params.query, params.candidates);
  if (reranked) {
    const scoreMap = new Map(reranked.map((item) => [item.id, item.score]));
    return params.candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreMap.get(candidate.id) ?? candidate.score
      }))
      .sort((a, b) => b.score - a.score);
  }
  return params.candidates;
}
