import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callMethod } from 'modelence/client';

import LoadingSpinner from '../components/LoadingSpinner';

type MemoryItem = {
  id: string;
  content: string;
  createdAt: string | Date;
  pinned: boolean;
  orgId: string;
  projectId: string;
  subjectId: string;
  tags?: string[];
  expiresAt?: string | Date;
  retention?: string;
};

type GetMemoriesResponse = {
  items: MemoryItem[];
  explanation: string;
};

type AddMemoryResponse = {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: string | Date;
  orgId: string;
  projectId: string;
  subjectId: string;
  tags?: string[];
  expiresAt?: string | Date;
  retention?: string;
  explanation: string;
  forgottenMemoryId: string | null;
};

type SearchMemoryResponse = {
  query: string;
  recipe: string;
  results: Array<MemoryItem & { score?: number; recipeScore?: number; graphHit?: boolean }>;
  explanation: string;
  metrics?: {
    rewriteApplied: boolean;
    rewriteLatencyMs: number;
    rerankApplied: boolean;
    rerankLatencyMs: number;
  };
};

type DeleteMemoryResponse = {
  success: boolean;
  explanation: string;
};

type PinMemoryResponse = {
  success: boolean;
  pinned: boolean;
  explanation: string;
};

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

function formatRetention(value?: string): string {
  const normalized = value ?? 'replaceable';
  return normalized.replace(/(^|\s|-)([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

type RetentionOption = 'auto' | 'irreplaceable' | 'permanent' | 'replaceable' | 'ephemeral';

const RETENTION_OPTIONS: { value: RetentionOption; label: string }[] = [
  { value: 'auto', label: 'Auto (based on pin & TTL)' },
  { value: 'irreplaceable', label: 'Irreplaceable (never forget)' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'replaceable', label: 'Replaceable' },
  { value: 'ephemeral', label: 'Ephemeral (decays quickly)' }
];

type AddMemoryVariables = {
  content: string;
  pinned: boolean;
  retention: RetentionOption;
};

export default function MemoryPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [retention, setRetention] = useState<RetentionOption>('auto');
  const [searchInput, setSearchInput] = useState('');

  const tenant = useMemo(
    () => ({
      orgId: (import.meta.env.VITE_CAPSULE_ORG_ID as string | undefined) ?? 'demo-org',
      projectId:
        (import.meta.env.VITE_CAPSULE_PROJECT_ID as string | undefined) ?? 'demo-project',
      subjectId:
        (import.meta.env.VITE_CAPSULE_SUBJECT_ID as string | undefined) ?? 'local-operator'
    }),
    []
  );

  const memoriesQuery = useQuery<GetMemoriesResponse>({
    queryKey: ['memory.getMemories'],
    queryFn: () => callMethod<GetMemoriesResponse>('memory.getMemories', tenant),
  });

  const addMemoryMutation = useMutation<AddMemoryResponse, Error, AddMemoryVariables>({
    mutationFn: (variables: AddMemoryVariables) =>
      callMethod<AddMemoryResponse>('memory.addMemory', {
        ...tenant,
        content: variables.content,
        pinned: variables.pinned,
        retention: variables.retention === 'auto' ? undefined : variables.retention,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory.getMemories'] });
      setContent('');
      setPinned(false);
      setRetention('auto');
    },
  });

  const pinMemoryMutation = useMutation<
    PinMemoryResponse,
    Error,
    { id: string; pin: boolean }
  >({
    mutationFn: (variables: { id: string; pin: boolean }) =>
      callMethod<PinMemoryResponse>('memory.pinMemory', {
        ...tenant,
        id: variables.id,
        pin: variables.pin,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory.getMemories'] });
    },
  });

  const deleteMemoryMutation = useMutation<
    DeleteMemoryResponse,
    Error,
    { id: string; reason?: string }
  >({
    mutationFn: (variables: { id: string; reason?: string }) =>
      callMethod<DeleteMemoryResponse>('memory.deleteMemory', {
        ...tenant,
        id: variables.id,
        reason: variables.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory.getMemories'] });
    },
  });

  const searchMemoryMutation = useMutation<
    SearchMemoryResponse,
    Error,
    { query: string }
  >({
    mutationFn: (variables: { query: string }) =>
      callMethod<SearchMemoryResponse>('memory.searchMemory', {
        ...tenant,
        query: variables.query,
        prompt: variables.query,
      }),
  });

  const memoryCount = memoriesQuery.data?.items?.length ?? 0;

  const sortedMemories = useMemo(() => {
    if (!memoriesQuery.data) {
      return [] as MemoryItem[];
    }
    return [...memoriesQuery.data.items].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [memoriesQuery.data]);

  const onSubmitMemory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) {
      return;
    }
    addMemoryMutation.mutate({ content: content.trim(), pinned, retention });
  };

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) {
      return;
    }
    searchMemoryMutation.mutate({ query: trimmed });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold">Capsule Memory</h1>
          <p className="text-slate-300">
            Store, retrieve, and manage long-term memories for your AI agents. Keep important details pinned and
            transparent.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/studio"
              className="inline-flex items-center rounded-lg border border-indigo-400 px-3 py-1.5 text-sm font-semibold text-indigo-300 transition hover:bg-indigo-500/10"
            >
              Open Capsule Studio →
            </Link>
          </div>
        </header>

        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg shadow-slate-900/40">
          <h2 className="text-2xl font-semibold mb-4">Add a memory</h2>
          <form onSubmit={onSubmitMemory} className="space-y-4">
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="What should the agent remember?"
              rows={4}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-white focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="text-sm font-semibold text-slate-300" htmlFor="retention">
                Retention policy
              </label>
              <select
                id="retention"
                value={retention}
                onChange={(event) => setRetention(event.target.value as RetentionOption)}
                className="w-full sm:w-64 rounded-lg border border-slate-700 bg-slate-950/80 p-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
              >
                {RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <label className="inline-flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                />
                Pin this memory (protect from auto-forget)
              </label>
              <button
                type="submit"
                disabled={addMemoryMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-60"
              >
                {addMemoryMutation.isPending ? 'Saving…' : 'Save memory'}
              </button>
            </div>
            {addMemoryMutation.data?.explanation && (
              <p className="text-sm text-slate-300">{addMemoryMutation.data.explanation}</p>
            )}
            {addMemoryMutation.data?.forgottenMemoryId && (
              <p className="text-xs text-amber-300">
                Automatically removed memory ID {addMemoryMutation.data.forgottenMemoryId} to enforce the limit.
              </p>
            )}
            {addMemoryMutation.isError && (
              <p className="text-sm text-rose-400">{(addMemoryMutation.error as Error).message}</p>
            )}
          </form>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-2xl font-semibold">Stored memories</h2>
            {memoriesQuery.data?.explanation && (
              <p className="text-sm text-slate-400">{memoriesQuery.data.explanation}</p>
            )}
          </div>

          {memoriesQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : null}

          {memoriesQuery.isError ? (
            <p className="text-sm text-rose-400">{(memoriesQuery.error as Error).message}</p>
          ) : null}

          {!memoriesQuery.isLoading && !memoriesQuery.isError && memoryCount === 0 ? (
            <p className="text-slate-400">No memories saved yet. Add one above to get started.</p>
          ) : null}

          <ul className="space-y-3">
            {sortedMemories.map((memory) => (
              <li
                key={memory.id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm shadow-slate-900/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-lg text-slate-100 whitespace-pre-line">{memory.content}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
                      <span>{formatDate(memory.createdAt)}</span>
                      {memory.pinned ? <span className="inline-flex items-center gap-1 text-amber-300">📌 Pinned</span> : null}
                      <span className="inline-flex items-center gap-1 text-sky-300">
                        Retention: {formatRetention(memory.retention)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        pinMemoryMutation.mutate({ id: memory.id, pin: !memory.pinned })
                      }
                      className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 transition hover:border-indigo-400 hover:text-indigo-200"
                    >
                      {memory.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMemoryMutation.mutate({ id: memory.id })}
                      className="rounded-lg border border-rose-600 px-3 py-1 text-sm text-rose-300 transition hover:bg-rose-500/10"
                    >
                      Forget
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-lg shadow-slate-900/40">
          <h2 className="text-2xl font-semibold mb-4">Semantic search</h2>
          <form onSubmit={onSearch} className="space-y-4">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Ask anything…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-white focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 transition hover:bg-emerald-400"
              disabled={searchMemoryMutation.isPending}
            >
              {searchMemoryMutation.isPending ? 'Searching…' : 'Search memories'}
            </button>
          </form>

          {searchMemoryMutation.isPending ? (
            <div className="flex justify-center py-6">
              <LoadingSpinner />
            </div>
          ) : null}

          {searchMemoryMutation.isError ? (
            <p className="mt-4 text-sm text-rose-400">{(searchMemoryMutation.error as Error).message}</p>
          ) : null}

          {searchMemoryMutation.data ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-slate-300">{searchMemoryMutation.data.explanation}</p>
              {searchMemoryMutation.data.metrics ? (
                  <div className="flex flex-wrap gap-3 text-xs uppercase tracking-wide text-slate-500">
                    <span>
                      rewrite: {searchMemoryMutation.data.metrics.rewriteApplied ? 'on' : 'off'}
                      {` (${searchMemoryMutation.data.metrics.rewriteLatencyMs}ms)`}
                    </span>
                    <span>
                      rerank: {searchMemoryMutation.data.metrics.rerankApplied ? 'on' : 'off'}
                      {` (${searchMemoryMutation.data.metrics.rerankLatencyMs}ms)`}
                    </span>
                    {searchMemoryMutation.data.results[0]?.retention ? (
                      <span>
                        top retention: {formatRetention(searchMemoryMutation.data.results[0]?.retention)}
                      </span>
                    ) : null}
                  </div>
              ) : null}
              {searchMemoryMutation.data.results.length === 0 ? (
                <p className="text-slate-400">No memories matched your query.</p>
              ) : (
                <ul className="space-y-3">
                  {searchMemoryMutation.data.results.map((result) => (
                    <li
                      key={result.id}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 shadow-sm shadow-slate-900/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <p className="text-slate-100 whitespace-pre-line">{result.content}</p>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
                            <span>{formatDate(result.createdAt)}</span>
                            {typeof result.score === 'number' ? (
                              <span className="text-slate-300">Relevance: {result.score.toFixed(3)}</span>
                            ) : null}
                            {result.pinned ? <span className="text-amber-300">📌 Pinned</span> : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
