export type CommonOpts = {
    baseUrl: string;
    apiKey: string;
    orgId: string;
    projectId: string;
    defaultSubjectId: string;
    fetchImpl?: typeof fetch;
};
export type CreateMemoryInput = {
    content: string;
    pinned?: boolean;
    tags?: string[];
    ttlSeconds?: number;
    idempotencyKey?: string;
    subjectId?: string;
};
export type UpdateMemoryInput = {
    id: string;
    pinned?: boolean;
    tags?: string[] | null;
    ttlSeconds?: number | null;
    subjectId?: string;
};
export type SearchInput = {
    query: string;
    limit?: number;
    subjectId?: string;
};
export type ListInput = {
    limit?: number;
    pinned?: boolean;
    tag?: string;
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
    updateMemory(input: UpdateMemoryInput): Promise<unknown>;
    deleteMemory(input: DeleteInput): Promise<unknown>;
}
