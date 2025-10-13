export type CommonOpts = {
  baseUrl: string;
  apiKey: string;
  orgId: string;
  projectId: string;
  defaultSubjectId: string;
  fetchImpl?: typeof fetch;
};

export type CapsuleVisibility = "private" | "shared" | "public";

export type CapsuleAcl = {
  visibility: CapsuleVisibility;
};

export type CapsuleSource = {
  app?: string;
  connector?: string;
  url?: string;
  fileId?: string;
  spanId?: string;
};

export type CapsulePiiFlags = Record<string, boolean>;

export type StorageDestination = "short_term" | "long_term" | "capsule_graph";

export type StorageConfig = {
  store?: StorageDestination;
  graphEnrich?: boolean | null;
  dedupeThreshold?: number | null;
};

export type StoragePolicySummary = {
  name: string;
  description?: string;
  defaults?: {
    store?: StorageDestination;
    ttlSeconds?: number | null;
    graphEnrich?: boolean;
    dedupeThreshold?: number;
    importanceScore?: number;
    notes?: string;
  };
};

export type CreateMemoryInput = {
  content: string;
  pinned?: boolean;
  tags?: string[];
  ttlSeconds?: number;
  idempotencyKey?: string;
  type?: string;
  lang?: string;
  importanceScore?: number;
  recencyScore?: number;
  source?: CapsuleSource | null;
  acl?: CapsuleAcl | null;
  piiFlags?: CapsulePiiFlags | null;
  storage?: StorageConfig | null;
  subjectId?: string;
};

export type UpdateMemoryInput = {
  id: string;
  pinned?: boolean;
  tags?: string[] | null;
  ttlSeconds?: number | null;
  type?: string | null;
  lang?: string | null;
  importanceScore?: number | null;
  recencyScore?: number | null;
  source?: CapsuleSource | null;
  acl?: CapsuleAcl | null;
  piiFlags?: CapsulePiiFlags | null;
  storage?: StorageConfig | null;
  subjectId?: string;
};

export type SearchInput = {
  query: string;
  limit?: number;
  recipe?: string;
  prompt?: string;
  subjectId?: string;
  rewrite?: boolean;
  rerank?: boolean;
};

export type ListInput = {
  limit?: number;
  pinned?: boolean;
  tag?: string;
  type?: string;
  visibility?: CapsuleVisibility;
  store?: StorageDestination;
  graphEnrich?: boolean;
  subjectId?: string;
};

export type DeleteInput = {
  id: string;
  reason?: string;
  subjectId?: string;
};

function trimBase(url: string) {
  return url.replace(/\/+$/, "");
}

export class CapsuleMemoryClient {
  #base: string;
  #apiKey: string;
  #org: string;
  #project: string;
  #subject: string;
  #fetch: typeof fetch;

  constructor(opts: CommonOpts) {
    this.#base = trimBase(opts.baseUrl);
    this.#apiKey = opts.apiKey;
    this.#org = opts.orgId;
    this.#project = opts.projectId;
    this.#subject = opts.defaultSubjectId;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    if (!this.#fetch) {
      throw new Error("No fetch implementation found. Use Node >=18 or pass fetchImpl.");
    }
  }

  private headers(subjectId?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Capsule-Key": this.#apiKey,
      "X-Capsule-Org": this.#org,
      "X-Capsule-Project": this.#project,
      "X-Capsule-Subject": subjectId ?? this.#subject
    };
  }

  private async request<T>(
    path: string,
    init?: RequestInit & { subjectId?: string }
  ): Promise<T> {
    const url = `${this.#base}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await this.#fetch(url, {
      method: init?.method ?? "GET",
      headers: { ...this.headers(init?.subjectId), ...(init?.headers as object) },
      body: init?.body
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    const payload = text ? JSON.parse(text) : {};
    return ("data" in payload ? payload.data : payload) as T;
  }

  async storeMemory(input: CreateMemoryInput) {
    return this.request("/v1/memories", {
      method: "POST",
      body: JSON.stringify({
        content: input.content,
        pinned: input.pinned,
        tags: input.tags,
        ttlSeconds: input.ttlSeconds,
        idempotencyKey: input.idempotencyKey,
        type: input.type,
        lang: input.lang,
        importanceScore: input.importanceScore,
        recencyScore: input.recencyScore,
        source: input.source,
        acl: input.acl,
        piiFlags: input.piiFlags,
        storage: input.storage
      }),
      subjectId: input.subjectId
    });
  }

  async listMemories(input: ListInput = {}) {
    const params = new URLSearchParams();
    if (input.limit) params.set("limit", String(input.limit));
    if (typeof input.pinned === "boolean") params.set("pinned", String(input.pinned));
    if (input.tag) params.set("tag", input.tag);
    if (input.type) params.set("type", input.type);
    if (input.visibility) params.set("visibility", input.visibility);
    if (input.store) params.set("store", input.store);
    if (typeof input.graphEnrich === "boolean") params.set("graphEnrich", String(input.graphEnrich));
    if (input.subjectId) params.set("subjectId", input.subjectId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/v1/memories${qs}`, { method: "GET", subjectId: input.subjectId });
  }

  async search(input: SearchInput) {
    const headers: Record<string, string> = {};
    if (typeof input.rewrite === "boolean") {
      headers["X-Capsule-Rewrite"] = String(input.rewrite);
    }
    if (typeof input.rerank === "boolean") {
      headers["X-Capsule-Rerank"] = String(input.rerank);
    }
    return this.request("/v1/memories/search", {
      method: "POST",
      body: JSON.stringify({
        query: input.query,
        limit: input.limit,
        recipe: input.recipe,
        prompt: input.prompt
      }),
      subjectId: input.subjectId,
      headers
    });
  }

  async listSearchRecipes() {
    return this.request("/v1/memories/recipes", { method: "GET" });
  }

  async listStoragePolicies(): Promise<{ policies: StoragePolicySummary[] }> {
    return this.request("/v1/memories/policies", { method: "GET" });
  }

  async updateMemory(input: UpdateMemoryInput) {
    return this.request(`/v1/memories/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        pinned: input.pinned,
        tags: input.tags,
        ttlSeconds: input.ttlSeconds,
        type: input.type,
        lang: input.lang,
        importanceScore: input.importanceScore,
        recencyScore: input.recencyScore,
        source: input.source,
        acl: input.acl,
        piiFlags: input.piiFlags,
        storage: input.storage
      }),
      subjectId: input.subjectId
    });
  }

  async deleteMemory(input: DeleteInput) {
    return this.request(`/v1/memories/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: input.reason }),
      subjectId: input.subjectId
    });
  }
}
