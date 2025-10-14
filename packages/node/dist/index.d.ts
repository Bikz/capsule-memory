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
export type CapsuleRetention = "irreplaceable" | "permanent" | "replaceable" | "ephemeral";
export type StorageConfig = {
    store?: StorageDestination;
    graphEnrich?: boolean | null;
    dedupeThreshold?: number | null;
};
export type CaptureStatus = "pending" | "approved" | "rejected" | "ignored";
export type CaptureMemoryOverride = {
    pinned?: boolean;
    tags?: string[];
    retention?: CapsuleRetention | "auto";
    type?: string;
    ttlSeconds?: number;
};
export type CaptureEventInput = {
    id?: string;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown>;
    autoAccept?: boolean;
    memory?: CaptureMemoryOverride | null;
};
export type CaptureScoreResult = {
    eventId?: string;
    candidateId?: string;
    status: CaptureStatus;
    recommended: boolean;
    score: number;
    reasons: string[];
    memoryId?: string | null;
};
export type CaptureScoreResponse = {
    threshold: number;
    results: CaptureScoreResult[];
};
export type CaptureCandidate = {
    id: string;
    eventId?: string | null;
    role: string;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
    threshold: number;
    recommended: boolean;
    category: string;
    reasons: string[];
    status: CaptureStatus;
    autoAccepted: boolean;
    autoDecisionReason?: string | null;
    memoryId?: string | null;
    createdAt: string;
    updatedAt: string;
};
export type CaptureApprovalResponse = {
    candidate: CaptureCandidate;
    memory: unknown;
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
    retention?: CapsuleRetention | null;
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
    retention?: CapsuleRetention | null;
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
    retention?: CapsuleRetention;
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
    scoreCapture(input: {
        events: CaptureEventInput[];
        threshold?: number;
        subjectId?: string;
    }): Promise<CaptureScoreResponse>;
    listCaptureCandidates(input?: {
        status?: CaptureStatus;
        limit?: number;
        subjectId?: string;
    }): Promise<{
        items: CaptureCandidate[];
    }>;
    approveCaptureCandidate(input: {
        id: string;
        memory?: CaptureMemoryOverride | null;
        subjectId?: string;
    }): Promise<CaptureApprovalResponse>;
    rejectCaptureCandidate(input: {
        id: string;
        reason?: string;
        subjectId?: string;
    }): Promise<CaptureCandidate>;
    updateMemory(input: UpdateMemoryInput): Promise<unknown>;
    deleteMemory(input: DeleteInput): Promise<unknown>;
}
