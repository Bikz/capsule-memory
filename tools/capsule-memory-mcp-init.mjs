#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MANIFEST = 'capsule-memory.mcp.json';

const manifestTemplate = {
  name: 'Capsule Memory',
  description: 'Expose Capsule Memory APIs to MCP-compatible agent clients.',
  entry_point: {
    type: 'stdio',
    command: 'npx',
    args: ['@capsule/mcp'],
    env: {
      CAPSULE_MEMORY_URL: process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000',
      CAPSULE_API_KEY: process.env.CAPSULE_API_KEY || 'demo-key',
      CAPSULE_DEFAULT_ORG_ID: process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org',
      CAPSULE_DEFAULT_PROJECT_ID: process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project',
      CAPSULE_DEFAULT_SUBJECT_ID: process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator'
    }
  }
};

async function main() {
  const args = process.argv.slice(2);
  const target = path.resolve(process.cwd(), args[0] || DEFAULT_MANIFEST);
  if (fs.existsSync(target)) {
    console.error(`Manifest already exists at ${target}. Delete it or choose another path.`);
    process.exit(1);
  }
  await fsPromises.writeFile(target, `${JSON.stringify(manifestTemplate, null, 2)}\n`, 'utf8');
  console.log(`Created MCP manifest at ${target}. Configure your MCP client to use this file.`);
}

main().catch((error) => {
  console.error('Failed to create MCP manifest:', error);
  process.exit(1);
});
