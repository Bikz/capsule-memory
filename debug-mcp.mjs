#!/usr/bin/env node

/**
 * Minimal MCP test to isolate parsing issues
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'debug-mcp',
  version: '0.1.0'
});

// Simple test tool with minimal schema
server.registerTool(
  'debug.test',
  {
    title: 'Debug Test Tool',
    description: 'A simple test tool to debug MCP parsing issues.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      },
      required: ['message']
    }
  },
  async (args) => {
    console.error(`[DEBUG] Received args:`, JSON.stringify(args, null, 2));
    
    return {
      content: [{ 
        type: 'text', 
        text: `Debug test received: ${args.message || 'no message'}` 
      }]
    };
  }
);

const transport = new StdioServerTransport();

const shutdown = async () => {
  try {
    await server.close();
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await server.connect(transport);
  console.error('Debug MCP server ready');
} catch (error) {
  console.error('Failed to start debug MCP server:', error);
  process.exit(1);
}