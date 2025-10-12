export type MemoryRecord = {
    id: string;
    orgId: string;
    projectId: string;
    subjectId: string;
    content: string;
    pinned: boolean;
    createdAt: string;
    tags?: string[];
    expiresAt?: string | null;
};
export type StoreMemoryResponse = MemoryRecord & {
    explanation: string;
    forgottenMemoryId: string | null;
};
export type ListMemoriesResponse = {
    explanation: string;
    items: MemoryRecord[];
};
export type SearchMemoriesResponse = {
    query: string;
    explanation: string;
    results: (MemoryRecord & {
        score?: number;
    })[];
};
export type UpdateMemoryResponse = {
    success: boolean;
    explanation: string;
    pinned?: boolean;
};
export type DeleteMemoryResponse = {
    success: boolean;
    explanation: string;
};
export type StoreMemoryInput = {
    content: string;
    pinned?: boolean;
    tags?: string[];
    ttlSeconds?: number;
    idempotencyKey?: string;
    subjectId?: string;
};
export type SearchMemoriesInput = {
    query: string;
    limit?: number;
    subjectId?: string;
};
export type ListMemoriesInput = {
    limit?: number;
    subjectId?: string;
    pinned?: boolean;
    tag?: string;
};
export type PinMemoryInput = {
    id: string;
    pin?: boolean;
    subjectId?: string;
};
export type DeleteMemoryInput = {
    id: string;
    subjectId?: string;
    reason?: string;
};
export type CapsuleMemoryClientOptions = {
    baseUrl: string;
    apiKey: string;
    orgId: string;
    projectId: string;
    defaultSubjectId?: string;
    fetchImplementation?: typeof fetch;
};
export declare class CapsuleMemoryError extends Error {
    readonly status: number;
    readonly details?: unknown;
    constructor(message: string, status: number, details?: unknown);
}
export declare class CapsuleMemoryClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly orgId;
    private readonly projectId;
    private readonly defaultSubjectId;
    private readonly fetchImpl;
    constructor(options: CapsuleMemoryClientOptions);
    private resolveSubject;
    private buildHeaders;
    private buildUrl;
    private request;
    storeMemory(input: StoreMemoryInput): Promise<StoreMemoryResponse>;
    listMemories(input?: ListMemoriesInput): Promise<ListMemoriesResponse>;
    searchMemories(input: SearchMemoriesInput): Promise<SearchMemoriesResponse>;
    pinMemory(input: PinMemoryInput): Promise<UpdateMemoryResponse>;
    deleteMemory(input: DeleteMemoryInput): Promise<DeleteMemoryResponse>;
}
//# sourceMappingURL=index.d.ts.map