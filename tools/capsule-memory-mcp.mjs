#!/usr/bin/env node

/**
 * Capsule Memory MCP bridge
 *
 * Exposes the Capsule Memory Modelence module as an MCP tool collection so
 * local agents (e.g. Claude desktop) can store and retrieve memories without
 * touching the existing web UI.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const BASE_URL =
  process.env.CAPSULE_MEMORY_URL ||
  process.env.MODELENCE_BASE_URL ||
  'http://localhost:3000';

const DEFAULT_CLIENT_INFO = {
  screenWidth: 1440,
  screenHeight: 900,
  windowWidth: 1280,
  windowHeight: 800,
  pixelRatio: 2,
  orientation: 'landscape-primary'
};

function buildUrl(methodName) {
  const trimmed = methodName.startsWith('/')
    ? methodName.slice(1)
    : methodName;
  return `${BASE_URL.replace(/\/$/, '')}/${trimmed}`;
}

async function callModelenceMethod(method, args = {}) {
  const response = await fetch(buildUrl(`api/_internal/method/${method}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      args,
      authToken: null,
      clientInfo: DEFAULT_CLIENT_INFO
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Modelence method ${method} failed with ${response.status}: ${errorBody}`
    );
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error(
      `Unexpected response from Modelence method ${method}: ${JSON.stringify(
        payload
      )}`
    );
  }

  return payload.data;
}

function formatMemorySummary(memory) {
  const pinnedBadge = memory.pinned ? '📌 ' : '';
  const createdAtValue =
    typeof memory.createdAt === 'string'
      ? memory.createdAt
      : memory.createdAt instanceof Date
        ? memory.createdAt.toISOString()
        : null;
  const createdAt = createdAtValue
    ? new Date(createdAtValue).toLocaleString()
    : 'unknown date';
  return `${pinnedBadge}${memory.content}\n  • id: ${memory.id}\n  • created: ${createdAt}`;
}

function serializeMemory(memory) {
  const createdAtValue =
    typeof memory.createdAt === 'string'
      ? memory.createdAt
      : memory.createdAt instanceof Date
        ? memory.createdAt.toISOString()
        : undefined;

  return {
    id: memory.id,
    content: memory.content,
    pinned: Boolean(memory.pinned),
    ...(createdAtValue ? { createdAt: createdAtValue } : {})
  };
}

const server = new McpServer({
  name: 'capsule-memory-mcp',
  version: '0.1.0'
});

// Zod shapes for tool schemas
const storeInputShape = {
  content: z.string(),
  pinned: z.boolean().optional()
};
const storeOutputShape = {
  id: z.string(),
  pinned: z.boolean(),
  explanation: z.string(),
  forgottenMemoryId: z.string().nullable()
};

const searchInputShape = {
  query: z.string(),
  limit: z.number().int().positive().max(20).optional()
};
const searchOutputShape = {
  query: z.string(),
  explanation: z.string(),
  results: z
    .array(
      z.object({
        id: z.string(),
        content: z.string(),
        pinned: z.boolean(),
        createdAt: z.string().optional(),
        score: z.number().optional()
      })
    )
    .default([])
};

const listInputShape = {
  limit: z.number().int().positive().max(100).optional()
};
const listOutputShape = {
  explanation: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      pinned: z.boolean(),
      createdAt: z.string().optional()
    })
  )
};

const pinInputShape = {
  id: z.string(),
  pin: z.boolean().optional()
};
const pinOutputShape = {
  success: z.boolean(),
  pinned: z.boolean(),
  explanation: z.string()
};

const forgetInputShape = {
  id: z.string(),
  reason: z.string().optional()
};
const forgetOutputShape = {
  success: z.boolean(),
  explanation: z.string()
};

server.registerTool(
  'capsule-memory.store',
  {
    description:
      'Persist a new memory entry in Capsule Memory. Optionally pin it to prevent auto-forget.',
    inputSchema: zodToJsonSchema(z.object(storeInputShape))
  },
  async ({ content, pinned }) => {
    const result = await callModelenceMethod('memory.addMemory', {
      content,
      pinned
    });

    const structured = {
      id: result.id,
      pinned: Boolean(result.pinned),
      explanation: result.explanation,
      forgottenMemoryId: result.forgottenMemoryId ?? null
    };

    const textLines = [
      `Saved memory ${result.id} (${structured.pinned ? 'pinned' : 'unpinned'}).`,
      structured.explanation
    ];
    if (structured.forgottenMemoryId) {
      textLines.push(`Auto-forgot memory ${structured.forgottenMemoryId}.`);
    }

    return {
      content: [{ type: 'text', text: textLines.join('\n') }],
      structuredContent: structured
    };
  }
);

server.registerTool(
  'capsule-memory.search',
  {
    description:
      'Run semantic search against Capsule Memory and return the most relevant entries.',
    inputSchema: zodToJsonSchema(z.object(searchInputShape))
  },
  async ({ query, limit }) => {
    const data = await callModelenceMethod('memory.searchMemory', {
      query,
      limit
    });

    const rawResults = Array.isArray(data.results) ? data.results : [];
    const results = rawResults.map((memory) => ({
      ...serializeMemory(memory),
      ...(memory.score !== undefined ? { score: memory.score } : {})
    }));
    const lines = [
      data.explanation ?? `Found ${results.length} memories.`,
      '',
      ...rawResults.map((memory, index) => {
        const score =
          memory.score !== undefined
            ? ` (score: ${memory.score.toFixed(3)})`
            : '';
        return `${index + 1}. ${formatMemorySummary(memory)}${score}`;
      })
    ];

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        query: data.query ?? query,
        explanation: data.explanation ?? '',
        results
      }
    };
  }
);

server.registerTool(
  'capsule-memory.list',
  {
    description:
      'Fetch the latest stored memories (pinned entries are prioritised).',
    inputSchema: zodToJsonSchema(z.object(listInputShape))
  },
  async ({ limit }) => {
    const data = await callModelenceMethod('memory.getMemories', { limit });
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.map(serializeMemory);
    const lines = [
      data.explanation ?? `Loaded ${items.length} memories.`,
      '',
      ...rawItems.map(
        (memory, index) => `${index + 1}. ${formatMemorySummary(memory)}`
      )
    ];

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        explanation: data.explanation ?? '',
        items
      }
    };
  }
);

server.registerTool(
  'capsule-memory.pin',
  {
    description:
      'Toggle the pinned status of an existing memory to protect it from auto-forget.',
    inputSchema: zodToJsonSchema(z.object(pinInputShape))
  },
  async ({ id, pin }) => {
    const result = await callModelenceMethod('memory.pinMemory', { id, pin });
    const structured = {
      success: Boolean(result.success),
      pinned: Boolean(result.pinned),
      explanation: result.explanation ?? ''
    };
    const text = `${structured.explanation || 'Updated pinned state.'} (pinned = ${
      structured.pinned ? 'true' : 'false'
    })`;

    return {
      content: [{ type: 'text', text }],
      structuredContent: structured
    };
  }
);

server.registerTool(
  'capsule-memory.forget',
  {
    description:
      'Delete a memory by ID. Provide an optional reason to log alongside the deletion.',
    inputSchema: zodToJsonSchema(z.object(forgetInputShape))
  },
  async ({ id, reason }) => {
    const result = await callModelenceMethod('memory.deleteMemory', {
      id,
      reason
    });
    const structured = {
      success: Boolean(result.success),
      explanation: result.explanation ?? `Memory ${id} forgotten.`
    };

    return {
      content: [{ type: 'text', text: structured.explanation }],
      structuredContent: structured
    };
  }
);

const transport = new StdioServerTransport();

const shutdown = async () => {
  try {
    await server.close();
  } catch (error) {
    console.error('Error during Capsule Memory MCP shutdown:', error);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

let keepAlive;

try {
  await server.connect(transport);
  console.error('Capsule Memory MCP bridge ready');
  keepAlive = setInterval(() => {}, 60_000);
} catch (error) {
  console.error('Failed to start Capsule Memory MCP server:', error);
  process.exit(1);
}

const previousOnClose = transport.onclose;
transport.onclose = (...args) => {
  if (typeof previousOnClose === 'function') {
    previousOnClose(...args);
  }
  if (keepAlive) {
    clearInterval(keepAlive);
    keepAlive = undefined;
  }
};
