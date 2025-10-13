#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PORT = Number.parseInt(process.env.CAPSULE_LOCAL_PORT ?? '5151', 10);
const DEFAULT_OUTPUT = process.argv[2] || 'capsule-local.mcp.json';

async function loadConfig() {
  const configPath = process.env.CAPSULE_LOCAL_CONFIG || path.resolve(process.cwd(), 'capsule-local.config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function main() {
  const config = await loadConfig();
  const manifest = {
    name: config.serviceName || 'Capsule Local',
    description:
      config.description ||
      'Local-first Capsule Memory cache for offline use and MCP integrations.',
    entry_point: {
      type: 'http',
      url: `http://localhost:${DEFAULT_PORT}/local/memories`
    },
    ...config.manifest
  };

  const outputPath = path.resolve(process.cwd(), DEFAULT_OUTPUT);
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote Capsule Local manifest to ${outputPath}`);
}

main().catch((error) => {
  console.error('Failed to generate Capsule Local manifest:', error);
  process.exit(1);
});
