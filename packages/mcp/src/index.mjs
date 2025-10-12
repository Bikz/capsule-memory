#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.CAPSULE_MEMORY_URL || "http://localhost:3000").replace(/\/+$/, "");
const API_KEY = process.env.CAPSULE_API_KEY || process.env.X_CAPSULE_KEY || "demo-key";
const TENANT = {
  orgId: process.env.CAPSULE_DEFAULT_ORG_ID || "demo-org",
  projectId: process.env.CAPSULE_DEFAULT_PROJECT_ID || "demo-project",
  subjectId: process.env.CAPSULE_DEFAULT_SUBJECT_ID || "local-operator"
};

function withTenant(subjectOverride) {
  return {
    "Content-Type": "application/json",
    "X-Capsule-Key": API_KEY,
    "X-Capsule-Org": TENANT.orgId,
    "X-Capsule-Project": TENANT.projectId,
    "X-Capsule-Subject": subjectOverride || TENANT.subjectId
  };
}

async function callApi(path, { method = "GET", body, subjectId } = {}) {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: withTenant(subjectId),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  const payload = text ? JSON.parse(text) : {};
  return "data" in payload ? payload.data : payload;
}

function summarize(memory) {
  const pinned = memory.pinned ? "📌 " : "";
  const created = memory.createdAt ? new Date(memory.createdAt).toLocaleString() : "unknown";
  const tags = Array.isArray(memory.tags) && memory.tags.length ? `  • tags: ${memory.tags.join(", ")}` : "";
  return `${pinned}${memory.content}\n  • id: ${memory.id}\n  • created: ${created}${tags}`;
}

const storeSchema = z.object({
  content: z.string(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  ttlSeconds: z.number().int().positive().max(365 * 24 * 3600).optional(),
  subjectId: z.string().optional()
});
const searchSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(20).optional(),
  subjectId: z.string().optional()
});
const listSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  pinned: z.boolean().optional(),
  tag: z.string().optional(),
  subjectId: z.string().optional()
});
const pinSchema = z.object({
  id: z.string(),
  pin: z.boolean().optional(),
  subjectId: z.string().optional()
});
const forgetSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
  subjectId: z.string().optional()
});

const server = new McpServer({ name: "capsule-memory-mcp", version: "0.1.0" });

server.registerTool(
  "capsule-memory.store",
  { description: "Store a memory (optionally pin, tag, TTL).", inputSchema: storeSchema },
  async (args) => {
    const input = storeSchema.parse(args);
    const data = await callApi("/v1/memories", {
      method: "POST",
      body: {
        content: input.content,
        pinned: input.pinned,
        tags: input.tags,
        ttlSeconds: input.ttlSeconds
      },
      subjectId: input.subjectId
    });
    const lines = [`Saved memory ${data.id} (${data.pinned ? "pinned" : "unpinned"}).`, data.explanation];
    if (data.forgottenMemoryId) lines.push(`Auto-forgot ${data.forgottenMemoryId}.`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "capsule-memory.search",
  { description: "Semantic search memories.", inputSchema: searchSchema },
  async (args) => {
    const input = searchSchema.parse(args);
    const data = await callApi("/v1/memories/search", {
      method: "POST",
      body: { query: input.query, limit: input.limit },
      subjectId: input.subjectId
    });
    const lines = [data.explanation, ""];
    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      const score = typeof r.score === "number" ? ` (score: ${r.score.toFixed(3)})` : "";
      lines.push(`${i + 1}. ${summarize(r)}${score}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "capsule-memory.list",
  { description: "List recent memories (supports limit/pinned/tag).", inputSchema: listSchema },
  async (args) => {
    const input = listSchema.parse(args);
    const params = new URLSearchParams();
    if (input.limit) params.set("limit", String(input.limit));
    if (typeof input.pinned === "boolean") params.set("pinned", String(input.pinned));
    if (input.tag) params.set("tag", input.tag);
    if (input.subjectId) params.set("subjectId", input.subjectId);
    const data = await callApi(`/v1/memories?${params.toString()}`, { subjectId: input.subjectId });
    const lines = [data.explanation, ""];
    for (let i = 0; i < data.items.length; i++) lines.push(`${i + 1}. ${summarize(data.items[i])}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "capsule-memory.pin",
  { description: "Pin or unpin a memory.", inputSchema: pinSchema },
  async (args) => {
    const input = pinSchema.parse(args);
    const data = await callApi(`/v1/memories/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      body: { pinned: input.pin ?? true },
      subjectId: input.subjectId
    });
    const text = `${data.explanation ?? "Updated pinned state."} (pinned = ${data.pinned ? "true" : "false"})`;
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "capsule-memory.forget",
  { description: "Delete a memory by ID.", inputSchema: forgetSchema },
  async (args) => {
    const input = forgetSchema.parse(args);
    const data = await callApi(`/v1/memories/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      body: input.reason ? { reason: input.reason } : undefined,
      subjectId: input.subjectId
    });
    return { content: [{ type: "text", text: data.explanation ?? `Memory ${input.id} forgotten.` }] };
  }
);

const transport = new StdioServerTransport();
const shutdown = async () => {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let keepAlive;
await server.connect(transport);
console.error("Capsule Memory MCP bridge ready");
keepAlive = setInterval(() => {}, 60_000);
if (typeof keepAlive.unref === "function") keepAlive.unref();
transport.onclose = () => {
  if (keepAlive) clearInterval(keepAlive);
};
