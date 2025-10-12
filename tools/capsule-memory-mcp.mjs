#!/usr/bin/env node

/**
 * Capsule Memory MCP bridge
 *
 * Exposes the Capsule Memory Modelence module as an MCP tool collection so
 * local agents (e.g. Claude desktop) can store and retrieve memories without
 * touching the existing web UI.
 *
 * This implementation keeps the canonical MCP tool schemas as JSON Schema to
 * match the protocol requirements and uses AJV to validate requests/responses.
 */

import Ajv from 'ajv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

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

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: true,
  useDefaults: true
});

function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

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

const JSON_SCHEMAS = {
  store: {
    input: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string', minLength: 1 },
        pinned: { type: 'boolean' }
      }
    },
    output: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'pinned', 'explanation', 'forgottenMemoryId'],
      properties: {
        id: { type: 'string' },
        pinned: { type: 'boolean' },
        explanation: { type: 'string' },
        forgottenMemoryId: { type: ['string', 'null'] }
      }
    }
  },
  search: {
    input: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      }
    },
    output: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['query', 'explanation', 'results'],
      properties: {
        query: { type: 'string' },
        explanation: { type: 'string' },
        results: {
          type: 'array',
          default: [],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'content', 'pinned'],
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              pinned: { type: 'boolean' },
              createdAt: { type: 'string' },
              score: { type: 'number' }
            }
          }
        }
      }
    }
  },
  list: {
    input: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    },
    output: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['explanation', 'items'],
      properties: {
        explanation: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'content', 'pinned'],
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              pinned: { type: 'boolean' },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    }
  },
  pin: {
    input: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1 },
        pin: { type: 'boolean' }
      }
    },
    output: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['success', 'pinned', 'explanation'],
      properties: {
        success: { type: 'boolean' },
        pinned: { type: 'boolean' },
        explanation: { type: 'string' }
      }
    }
  },
  forget: {
    input: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 }
      }
    },
    output: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['success', 'explanation'],
      properties: {
        success: { type: 'boolean' },
        explanation: { type: 'string' }
      }
    }
  }
};

function createValidator(schema) {
  if (!schema) {
    return () => ({ valid: true, data: undefined, errors: [] });
  }
  const validate = ajv.compile(schema);
  return (data) => {
    const valid = validate(data);
    return { valid, data, errors: validate.errors ?? [] };
  };
}

function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) {
    return 'Unknown validation error';
  }

  return errors
    .map((error) => {
      const path = error.instancePath ? error.instancePath.slice(1) : '';
      const location = path || '(root)';
      const message = error.message || 'is invalid';
      return `${location} ${message}`;
    })
    .join('; ');
}

const TOOL_DEFINITIONS = [
  {
    name: 'capsule-memory.store',
    description:
      'Persist a new memory entry in Capsule Memory. Optionally pin it to prevent auto-forget.',
    inputSchema: JSON_SCHEMAS.store.input,
    outputSchema: JSON_SCHEMAS.store.output,
    handler: async ({ content, pinned }) => {
      const result = await callModelenceMethod('memory.addMemory', {
        content,
        pinned
      });

      const structured = {
        id: result.id,
        pinned: Boolean(result.pinned),
        explanation: result.explanation ?? '',
        forgottenMemoryId: result.forgottenMemoryId ?? null
      };

      const textLines = [
        `Saved memory ${structured.id} (${structured.pinned ? 'pinned' : 'unpinned'}).`,
        structured.explanation
      ];
      if (structured.forgottenMemoryId) {
        textLines.push(
          `Auto-forgot memory ${structured.forgottenMemoryId}.`
        );
      }

      return {
        content: [{ type: 'text', text: textLines.join('\n') }],
        structuredContent: structured
      };
    }
  },
  {
    name: 'capsule-memory.search',
    description:
      'Run semantic search against Capsule Memory and return the most relevant entries.',
    inputSchema: JSON_SCHEMAS.search.input,
    outputSchema: JSON_SCHEMAS.search.output,
    handler: async ({ query, limit }) => {
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
  },
  {
    name: 'capsule-memory.list',
    description:
      'Fetch the latest stored memories (pinned entries are prioritised).',
    inputSchema: JSON_SCHEMAS.list.input,
    outputSchema: JSON_SCHEMAS.list.output,
    handler: async ({ limit }) => {
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
  },
  {
    name: 'capsule-memory.pin',
    description:
      'Toggle the pinned status of an existing memory to protect it from auto-forget.',
    inputSchema: JSON_SCHEMAS.pin.input,
    outputSchema: JSON_SCHEMAS.pin.output,
    handler: async ({ id, pin }) => {
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
  },
  {
    name: 'capsule-memory.forget',
    description:
      'Delete a memory by ID. Provide an optional reason to log alongside the deletion.',
    inputSchema: JSON_SCHEMAS.forget.input,
    outputSchema: JSON_SCHEMAS.forget.output,
    handler: async ({ id, reason }) => {
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
  }
];

const toolRegistry = TOOL_DEFINITIONS.reduce((registry, tool) => {
  registry[tool.name] = {
    ...tool,
    validateInput: createValidator(tool.inputSchema),
    validateOutput: createValidator(tool.outputSchema)
  };
  return registry;
}, {});

const server = new Server(
  { name: 'capsule-memory-mcp', version: '0.2.0' },
  {
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: false }
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: TOOL_DEFINITIONS.map(
    ({ name, description, inputSchema, outputSchema }) => ({
      name,
      description,
      inputSchema,
      ...(outputSchema ? { outputSchema } : {})
    })
  )
}));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const tool = toolRegistry[request.params.name];
  if (!tool) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Tool ${request.params.name} not found`
    );
  }

  const args = clone(request.params.arguments ?? {});
  const validation = tool.validateInput(args);
  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for tool ${request.params.name}: ${formatAjvErrors(
        validation.errors
      )}`
    );
  }

  let result;
  try {
    result = await tool.handler(args, extra);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unknown error: ${error}`;
    return {
      content: [{ type: 'text', text: message }],
      isError: true
    };
  }

  if (!result || typeof result !== 'object') {
    throw new McpError(
      ErrorCode.InternalError,
      `Tool ${request.params.name} returned an invalid response`
    );
  }

  if (!Array.isArray(result.content)) {
    throw new McpError(
      ErrorCode.InternalError,
      `Tool ${request.params.name} must return a content array`
    );
  }

  if (tool.outputSchema && !result.isError) {
    if (!result.structuredContent) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool ${request.params.name} expected structured content but none was provided`
      );
    }
    const outputClone = clone(result.structuredContent);
    const outputValidation = tool.validateOutput(outputClone);
    if (!outputValidation.valid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid structured content for tool ${
          request.params.name
        }: ${formatAjvErrors(outputValidation.errors)}`
      );
    }
    result.structuredContent = outputClone;
  }

  return result;
});

server.setRequestHandler(ListResourcesRequestSchema, () => ({
  resources: []
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
  resourceTemplates: []
}));

server.setRequestHandler(ReadResourceRequestSchema, (request) => {
  throw new McpError(
    ErrorCode.InvalidRequest,
    `Resource ${request.params.uri} is not available from this server`
  );
});

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
  server.sendToolListChanged();
  server.sendResourceListChanged();
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
