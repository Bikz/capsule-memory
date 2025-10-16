#!/usr/bin/env node
import { Command } from 'commander';
import { CapsuleMemoryClient } from '@capsule/sdk-js';

const program = new Command();
program.name('capsule').description('Capsule Memory CLI');

program
  .command('add')
  .requiredOption('-c, --content <text>', 'memory content')
  .option('-m, --meta <json>', 'metadata JSON')
  .action(async (options) => {
    const client = new CapsuleMemoryClient({
      baseUrl: process.env.CAPSULE_URL ?? 'http://localhost:3000',
      apiKey: process.env.CAPSULE_API_KEY ?? 'demo-key',
      orgId: process.env.CAPSULE_ORG_ID ?? 'demo-org',
      projectId: process.env.CAPSULE_PROJECT_ID ?? 'demo-project',
      defaultSubjectId: process.env.CAPSULE_SUBJECT_ID ?? 'local-user'
    });

    const meta = options.meta ? JSON.parse(options.meta) : {};
    const response = await client.storeMemory({ content: options.content, ...meta });
    console.log(JSON.stringify(response, null, 2));
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
