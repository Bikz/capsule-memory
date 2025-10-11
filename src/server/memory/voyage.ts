import { getConfig } from 'modelence/server';
import { VoyageAIClient } from 'voyageai';

import { EMBEDDING_DIMENSIONS } from './db';

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

function buildFallbackEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (!text) {
    return vector;
  }

  for (let i = 0; i < text.length; i += 1) {
    const charCode = text.charCodeAt(i);
    const index = charCode % EMBEDDING_DIMENSIONS;
    const value = ((charCode % 13) - 6) / 6;
    vector[index] += value;
  }

  return vector;
}

export async function generateEmbedding(
  text: string,
  inputType: 'document' | 'query' = 'document'
): Promise<number[]> {
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
  const { data } = await client.embed({
    input: [text],
    model: 'voyage-3.5',
    inputType
  });

  if (!data || data.length === 0 || !data[0].embedding) {
    throw new Error('Voyage embedding response did not include embedding data');
  }

  return data[0].embedding;
}
