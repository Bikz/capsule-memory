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
    subjectId?: string;
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
export declare class CapsuleMemoryClient {
    #private;
    constructor(opts: CommonOpts);
    private headers;
    private request;
    storeMemory(input: CreateMemoryInput): Promise<unknown>;
    listMemories(input?: ListInput): Promise<unknown>;
    search(input: SearchInput): Promise<unknown>;
    listSearchRecipes(): Promise<unknown>;
    listStoragePolicies(): Promise<{
        policies: StoragePolicySummary[];
    }>;
    updateMemory(input: UpdateMemoryInput): Promise<unknown>;
    deleteMemory(input: DeleteInput): Promise<unknown>;
}
