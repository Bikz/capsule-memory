import { getConfig } from 'modelence/server';
import { VoyageAIClient } from 'voyageai';

import { EMBEDDING_DIMENSIONS } from './db';

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  strategy: 'voyage' | 'fallback';
};

let voyageClient: VoyageAIClient | null = null;
let missingKeyWarned = false;

function resolveVoyageApiKey(): string | null {
  const configured = getConfig('voyage.apiKey') as string | undefined;
  const fromEnv = process.env.VOYAGE_API_KEY;
  return configured || fromEnv || null;
}

function ensureClient(): VoyageAIClient {
  if (!voyageClient) {
    const apiKey = resolveVoyageApiKey();
    if (!apiKey) {
      throw new Error('Voyage API key not configured');
    }
    voyageClient = new VoyageAIClient({ apiKey });
  }
  return voyageClient;
}

function buildFallbackEmbedding(text: string): EmbeddingResult {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (!text) {
    return {
      embedding: vector,
      model: 'capsule-fallback-1024',
      strategy: 'fallback'
    };
  }

  for (let i = 0; i < text.length; i += 1) {
    const charCode = text.charCodeAt(i);
    const index = charCode % EMBEDDING_DIMENSIONS;
    const value = ((charCode % 13) - 6) / 6;
    vector[index] += value;
  }

  return {
    embedding: vector,
    model: 'capsule-fallback-1024',
    strategy: 'fallback'
  };
}

export async function generateEmbedding(
  text: string,
  inputType: 'document' | 'query' = 'document'
): Promise<EmbeddingResult> {
  const apiKey = resolveVoyageApiKey();
  if (!apiKey) {
    if (!missingKeyWarned) {
      missingKeyWarned = true;
      console.warn(
        'Voyage API key is not set. Falling back to deterministic local embeddings for development.'
      );
    }
    return buildFallbackEmbedding(text);
  }

  const client = ensureClient();
  const model = 'voyage-3.5';
  const { data } = await client.embed({
    input: [text],
    model,
    inputType
  });

  if (!data || data.length === 0 || !data[0].embedding) {
    throw new Error('Voyage embedding response did not include embedding data');
  }

  return {
    embedding: data[0].embedding,
    model,
    strategy: 'voyage'
  };
}
