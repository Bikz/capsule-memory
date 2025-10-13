import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { callMethod } from 'modelence/client';

import LoadingSpinner from '@/client/components/LoadingSpinner';

type Tenant = {
  orgId: string;
  projectId: string;
  subjectId: string;
};

type SearchRecipeFilters = {
  pinnedOnly?: boolean;
  graphEnrich?: boolean;
  types?: string[];
};

type SearchRecipeDefinition = {
  name: string;
  label: string;
  description: string;
  limit: number;
  candidateLimit: number;
  filters?: SearchRecipeFilters;
  scoring: {
    semanticWeight: number;
    importanceWeight?: number;
    recencyWeight?: number;
    pinnedBoost?: number;
  };
};

type ListRecipesResponse = {
  recipes: SearchRecipeDefinition[];
};

type ListPoliciesResponse = {
  policies: Array<{
    name: string;
    description?: string;
    defaults?: {
      store?: string;
      ttlSeconds?: number | null;
      graphEnrich?: boolean;
      dedupeThreshold?: number;
      importanceScore?: number;
      notes?: string;
    };
  }>;
};

type RecipePreviewResponse = {
  query: string;
  recipe: string;
  explanation: string;
  results: Array<{
    id: string;
    content: string;
    score?: number;
    recipeScore?: number;
    tags?: string[];
    pinned?: boolean;
    createdAt?: string;
  }>;
};

type PolicyPreviewResponse = {
  store: string;
  graphEnrich: boolean;
  dedupeThreshold: number | null;
  ttlSeconds: number | null;
  importanceScore: number | null;
  appliedPolicies: string[];
};

type ConnectorSummary = {
  id: string;
  provider: string;
  label: string;
  description?: string;
  docs?: string;
  env?: string[];
  tags?: string[];
  latestJob: {
    id: string;
    status: string;
    itemCount: number;
    updatedAt: string;
    error: string | null;
  } | null;
};

type ConnectorListResponse = {
  connectors: ConnectorSummary[];
};

type ConnectorJobsResponse = {
  jobs: Array<{
    id: string;
    connectorId: string;
    provider: string;
    status: string;
    itemCount?: number;
    error?: string;
    dataset?: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

function useTenant(): Tenant {
  return useMemo(
    () => ({
      orgId: (import.meta.env.VITE_CAPSULE_ORG_ID as string | undefined) ?? 'demo-org',
      projectId:
        (import.meta.env.VITE_CAPSULE_PROJECT_ID as string | undefined) ?? 'demo-project',
      subjectId:
        (import.meta.env.VITE_CAPSULE_SUBJECT_ID as string | undefined) ?? 'local-operator'
    }),
    []
  );
}

export default function StudioPage(): JSX.Element {
  const tenant = useTenant();
  const [activeTab, setActiveTab] = useState<'recipes' | 'policies' | 'connectors'>('recipes');

  const recipesQuery = useQuery<ListRecipesResponse>({
    queryKey: ['memory.listSearchRecipes'],
    queryFn: () => callMethod('memory.listSearchRecipes', tenant)
  });

  const policiesQuery = useQuery<ListPoliciesResponse>({
    queryKey: ['memory.listStoragePolicies'],
    queryFn: () => callMethod('memory.listStoragePolicies', tenant)
  });

  const connectorsQuery = useQuery<ConnectorListResponse>({
    queryKey: ['connectors.listConnectors'],
    queryFn: () => callMethod('connectors.listConnectors', {}),
    refetchInterval: 15000
  });

  const connectorJobsQuery = useQuery<ConnectorJobsResponse>({
    queryKey: ['connectors.listJobs'],
    queryFn: () => callMethod('connectors.listJobs', { limit: 50 }),
    refetchInterval: 10000
  });

  const [selectedRecipeName, setSelectedRecipeName] = useState<string | null>(null);
  const [recipeDraft, setRecipeDraft] = useState('');
  const [samplePrompt, setSamplePrompt] = useState(
    'Summarise the conversation with Alex about upgrading their workspace.'
  );
  const [recipeError, setRecipeError] = useState<string | null>(null);

  const previewRecipeMutation = useMutation<RecipePreviewResponse, Error, {
    recipe: SearchRecipeDefinition;
    query: string;
    limit?: number;
  }>({
    mutationFn: (variables) =>
      callMethod('memory.previewRecipe', {
        ...tenant,
        recipe: variables.recipe,
        query: variables.query,
        limit: variables.limit
      })
  });

  const previewPolicyMutation = useMutation<PolicyPreviewResponse, Error, {
    type?: string | null;
    tags?: string[];
    pinned?: boolean;
    connector?: string;
    acl?: string;
  }>({
    mutationFn: (variables) =>
      callMethod('memory.previewStoragePolicies', {
        ...tenant,
        type: variables.type ?? undefined,
        tags: variables.tags && variables.tags.length > 0 ? variables.tags : undefined,
        pinned: variables.pinned,
        source: variables.connector ? { connector: variables.connector } : undefined,
      acl: variables.acl ? { visibility: variables.acl as 'private' | 'shared' | 'public' } : undefined
      })
  });

  const scheduleConnectorMutation = useMutation<{ jobId: string }, Error, { connectorId: string; dataset?: string }>(
    {
      mutationFn: (variables) =>
        callMethod('connectors.scheduleIngestion', {
          connectorId: variables.connectorId,
          dataset: variables.dataset
        }),
      onSuccess: () => {
        connectorJobsQuery.refetch();
        connectorsQuery.refetch();
      }
    }
  );

  useEffect(() => {
    if (!recipesQuery.data || recipesQuery.data.recipes.length === 0) {
      return;
    }
    const initial = selectedRecipeName ?? recipesQuery.data.recipes[0].name;
    setSelectedRecipeName(initial);
    const recipe = recipesQuery.data.recipes.find((item) => item.name === initial);
    if (recipe) {
      setRecipeDraft(JSON.stringify(recipe, null, 2));
    }
  }, [recipesQuery.data, selectedRecipeName]);

  const onRecipeSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedRecipeName(value);
    const recipe = recipesQuery.data?.recipes.find((item) => item.name === value);
    if (recipe) {
      setRecipeDraft(JSON.stringify(recipe, null, 2));
      setRecipeError(null);
      previewRecipeMutation.reset();
    }
  };

  const handleRecipePreview = () => {
    if (!recipeDraft.trim()) {
      setRecipeError('Provide a recipe definition.');
      return;
    }
    try {
      const parsed = JSON.parse(recipeDraft) as SearchRecipeDefinition;
      setRecipeError(null);
      previewRecipeMutation.mutate({ recipe: parsed, query: samplePrompt });
    } catch (error) {
      setRecipeError((error as Error).message);
    }
  };

  const [policyType, setPolicyType] = useState('');
  const [policyConnector, setPolicyConnector] = useState('');
  const [policyTags, setPolicyTags] = useState('');
  const [policyPinned, setPolicyPinned] = useState(false);
  const [policyAcl, setPolicyAcl] = useState<'private' | 'shared' | 'public'>('private');

  const onPolicyPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tags = policyTags
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    previewPolicyMutation.mutate({
      type: policyType || undefined,
      tags,
      pinned: policyPinned,
      connector: policyConnector || undefined,
      acl: policyAcl
    });
  };

  const onScheduleIngestion = (connectorId: string) => {
    const dataset = window.prompt('Dataset label (optional):') ?? undefined;
    scheduleConnectorMutation.mutate({ connectorId, dataset: dataset || undefined });
  };

  const renderRecipesTab = () => {
    if (recipesQuery.isLoading) {
      return (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      );
    }

    if (recipesQuery.isError || !recipesQuery.data) {
      return <p className="text-red-400">Failed to load recipes.</p>;
    }

    const selectedRecipe = recipesQuery.data.recipes.find((item) => item.name === selectedRecipeName);

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Search recipes</h2>
            <p className="text-slate-300">
              Inspect and tweak the recipe DSL, then preview how the tuned blend behaves on a sample prompt.
            </p>
          </div>
          <select
            value={selectedRecipeName ?? ''}
            onChange={onRecipeSelect}
            className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-white focus:border-indigo-400 focus:outline-none"
          >
            {recipesQuery.data.recipes.map((recipe) => (
              <option key={recipe.name} value={recipe.name}>
                {recipe.label} ({recipe.name})
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">Recipe JSON</label>
            <textarea
              rows={20}
              value={recipeDraft}
              onChange={(event) => setRecipeDraft(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 p-3 font-mono text-sm text-slate-100 focus:border-indigo-400 focus:outline-none"
            />
            {recipeError ? <p className="text-sm text-red-400">{recipeError}</p> : null}
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">Sample prompt</label>
            <textarea
              rows={6}
              value={samplePrompt}
              onChange={(event) => setSamplePrompt(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-slate-100 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleRecipePreview}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white shadow transition hover:bg-indigo-400"
              disabled={previewRecipeMutation.isPending}
            >
              {previewRecipeMutation.isPending ? 'Previewing…' : 'Preview search'}
            </button>

            {previewRecipeMutation.isError ? (
              <p className="text-sm text-red-400">{previewRecipeMutation.error.message}</p>
            ) : null}

            {previewRecipeMutation.data ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-sm text-slate-300">{previewRecipeMutation.data.explanation}</p>
                <div className="mt-4 space-y-3">
                  {previewRecipeMutation.data.results.map((item, index) => (
                    <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>{index + 1}. {item.id}</span>
                        <span>
                          score: {(item.recipeScore ?? item.score ?? 0).toFixed(3)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-100">{item.content}</p>
                      {item.tags && item.tags.length > 0 ? (
                        <p className="mt-2 text-xs uppercase tracking-wide text-indigo-300">
                          tags: {item.tags.join(', ')}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {previewRecipeMutation.data.results.length === 0 ? (
                    <p className="text-sm text-slate-400">No results for that query.</p>
                  ) : null}
                </div>
              </div>
            ) : selectedRecipe ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
                <p className="font-semibold text-slate-200">{selectedRecipe.description}</p>
                <p className="mt-2">
                  Limit <strong>{selectedRecipe.limit}</strong>, candidate window <strong>{selectedRecipe.candidateLimit}</strong>. Semantic weight <strong>{selectedRecipe.scoring.semanticWeight}</strong>{' '}
                  {selectedRecipe.scoring.importanceWeight !== undefined ? `• importance ${selectedRecipe.scoring.importanceWeight}` : ''}
                  {selectedRecipe.scoring.recencyWeight !== undefined ? ` • recency ${selectedRecipe.scoring.recencyWeight}` : ''}
                  {selectedRecipe.scoring.pinnedBoost !== undefined ? ` • pinned boost ${selectedRecipe.scoring.pinnedBoost}` : ''}.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderPoliciesTab = () => {
    if (policiesQuery.isLoading) {
      return (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      );
    }

    if (policiesQuery.isError || !policiesQuery.data) {
      return <p className="text-red-400">Failed to load storage policies.</p>;
    }

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Programmable storage policies</h2>
          <p className="text-slate-300">
            Evaluate how incoming memories will be routed given type, connector, tags, and pinning. Use this to tune
            TTLs, dedupe thresholds, and enrichment behaviour before rolling changes into production.
          </p>
        </div>

        <form onSubmit={onPolicyPreview} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-200">
              <span>Memory type</span>
              <input
                value={policyType}
                onChange={(event) => setPolicyType(event.target.value)}
                placeholder="preference, log, knowledge…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-white focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-200">
              <span>Connector</span>
              <input
                value={policyConnector}
                onChange={(event) => setPolicyConnector(event.target.value)}
                placeholder="notion, drive, slack…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-white focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-200">
              <span>Tags (comma separated)</span>
              <input
                value={policyTags}
                onChange={(event) => setPolicyTags(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-white focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-200">
              <span>ACL visibility</span>
              <select
                value={policyAcl}
                onChange={(event) => setPolicyAcl(event.target.value as 'private' | 'shared' | 'public')}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-white focus:border-indigo-400 focus:outline-none"
              >
                <option value="private">private</option>
                <option value="shared">shared</option>
                <option value="public">public</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={policyPinned}
              onChange={(event) => setPolicyPinned(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-500 focus:ring-indigo-400"
            />
            Treat as pinned memory
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white shadow transition hover:bg-indigo-400"
            disabled={previewPolicyMutation.isPending}
          >
            {previewPolicyMutation.isPending ? 'Evaluating…' : 'Preview storage decision'}
          </button>
          {previewPolicyMutation.isError ? (
            <p className="text-sm text-red-400">{previewPolicyMutation.error.message}</p>
          ) : null}
          {previewPolicyMutation.data ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-200">
              <p>
                Store: <span className="font-semibold text-indigo-300">{previewPolicyMutation.data.store}</span>
              </p>
              <p>
                Graph enrichment: {previewPolicyMutation.data.graphEnrich ? 'enabled' : 'disabled'}
              </p>
              <p>
                TTL: {previewPolicyMutation.data.ttlSeconds === null
                  ? '∞'
                  : previewPolicyMutation.data.ttlSeconds ?? 'inherit'} seconds
              </p>
              <p>
                Dedupe threshold: {previewPolicyMutation.data.dedupeThreshold ?? '—'}
              </p>
              <p>
                Importance score boost: {previewPolicyMutation.data.importanceScore ?? '—'}
              </p>
              <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">
                Applied policies: {previewPolicyMutation.data.appliedPolicies.join(', ') || 'default'}
              </p>
            </div>
          ) : null}
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Policy</th>
                <th className="px-4 py-3 text-left font-semibold">Store</th>
                <th className="px-4 py-3 text-left font-semibold">TTL</th>
                <th className="px-4 py-3 text-left font-semibold">Graph</th>
                <th className="px-4 py-3 text-left font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {policiesQuery.data.policies.map((policy) => (
                <tr key={policy.name}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{policy.name}</div>
                    {policy.description ? (
                      <div className="text-xs text-slate-400">{policy.description}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{policy.defaults?.store ?? 'long_term'}</td>
                  <td className="px-4 py-3">
                    {policy.defaults?.ttlSeconds === null
                      ? '∞'
                      : policy.defaults?.ttlSeconds ?? 'inherit'}
                  </td>
                  <td className="px-4 py-3">{policy.defaults?.graphEnrich ? 'enabled' : 'disabled'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{policy.defaults?.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderConnectorsTab = () => {
    if (connectorsQuery.isLoading || connectorJobsQuery.isLoading) {
      return (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      );
    }

    if (connectorsQuery.isError || !connectorsQuery.data) {
      return <p className="text-red-400">Failed to load connector catalog.</p>;
    }

    const jobs = connectorJobsQuery.data?.jobs ?? [];

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Connector ingestion monitor</h2>
          <p className="text-slate-300">
            Trigger connector syncs and monitor their status. Use the CLI (`npm run ingest`) for full fetch cycles—
            each run records a job that appears here for auditing and retries.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {connectorsQuery.data.connectors.map((connector) => (
            <div key={connector.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-slate-900/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{connector.label}</h3>
                  <p className="mt-1 text-sm text-slate-300">{connector.description}</p>
                  <p className="mt-2 text-xs text-slate-400">ENV: {connector.env?.join(', ') ?? 'n/a'}</p>
                  {connector.tags && connector.tags.length > 0 ? (
                    <p className="mt-1 text-xs uppercase tracking-wide text-indigo-300">{connector.tags.join(' • ')}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onScheduleIngestion(connector.id)}
                  className="inline-flex items-center rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-400"
                  disabled={scheduleConnectorMutation.isPending}
                >
                  Schedule job
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                <p>
                  Latest status:{' '}
                  {connector.latestJob
                    ? `${connector.latestJob.status} • ${connector.latestJob.updatedAt}`
                    : 'no runs yet'}
                </p>
                {connector.latestJob?.error ? (
                  <p className="mt-1 text-red-400">{connector.latestJob.error}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Job</th>
                <th className="px-4 py-3 text-left font-semibold">Connector</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Items</th>
                <th className="px-4 py-3 text-left font-semibold">Updated</th>
                <th className="px-4 py-3 text-left font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3 text-xs font-mono">{job.id}</td>
                  <td className="px-4 py-3">{job.connectorId}</td>
                  <td className="px-4 py-3">{job.status}</td>
                  <td className="px-4 py-3">{job.itemCount ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(job.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-red-400">{job.error ?? ''}</td>
                </tr>
              ))}
              {jobs.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-center text-slate-400" colSpan={6}>
                    No ingestion jobs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold">Capsule Studio</h1>
          <p className="text-slate-300">
            Tune search recipes and programmable storage policies with live previews before rolling changes into your router or MCP workflows.
          </p>
        </header>

        <div className="flex gap-4 border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('recipes')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'recipes'
                ? 'border-b-2 border-indigo-400 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Search recipes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('policies')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'policies'
                ? 'border-b-2 border-indigo-400 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Storage policies
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('connectors')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'connectors'
                ? 'border-b-2 border-indigo-400 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Connectors & ingest
          </button>
        </div>

        {activeTab === 'recipes'
          ? renderRecipesTab()
          : activeTab === 'policies'
            ? renderPoliciesTab()
            : renderConnectorsTab()}
      </div>
    </div>
  );
}
