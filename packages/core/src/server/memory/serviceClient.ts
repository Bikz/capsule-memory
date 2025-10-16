import { performance } from 'node:perf_hooks';

export type ServiceFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ServiceFetchResult<T> = {
  ok: boolean;
  status: number;
  latencyMs: number;
  data?: T;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CAPSULE_SERVICE_TIMEOUT ?? '1200', 10);

export async function jsonServiceFetch<T = any>(
  endpoint: string,
  options: ServiceFetchOptions
): Promise<ServiceFetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const start = performance.now();

  try {
    const res = await fetch(endpoint, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? controller.signal
    });
    const latencyMs = performance.now() - start;
    clearTimeout(timeout);
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: text
      };
    }
    const payload = text ? (JSON.parse(text) as T) : (undefined as T | undefined);
    return {
      ok: true,
      status: res.status,
      latencyMs,
      data: payload
    };
  } catch (error) {
    clearTimeout(timeout);
    const latencyMs = performance.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Capsule] service fetch failed:', endpoint, message);
    return {
      ok: false,
      status: 0,
      latencyMs,
      error: message
    };
  }
}
