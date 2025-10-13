#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_ROOT = path.resolve(ROOT, 'dist');
const STAGING_DIR = path.resolve(DIST_ROOT, 'capsule-local-bundle');
const ARCHIVE_PATH = path.resolve(DIST_ROOT, 'capsule-local-bundle.tar.gz');
const MANIFEST_SCRIPT = path.resolve(ROOT, 'tools', 'capsule-local-manifest.mjs');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyIfExists(source, target) {
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.warn(`[Capsule] Optional bundle file missing: ${source}`);
      return;
    }
    throw error;
  }
}

async function runManifest(outputPath) {
  await new Promise((resolve, reject) => {
    execFile('node', [MANIFEST_SCRIPT, outputPath], (error, stdout, stderr) => {
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function writeReadme(outputPath) {
  const contents = `# Capsule Local Bundle\n\nThis archive contains:\n- Capsule Local service entrypoint (capsule-local.mjs).\n- Deployment configuration (capsule-local.config.json).\n- MCP manifest (capsule-local.mcp.json).\n\n## Usage\n1. Extract the archive.\n2. Install dependencies (requires Node 18+ and sqlite3).\n3. Run \`node capsule-local.mjs\` to start Capsule Local.\n4. Update \`capsule-local.config.json\` as needed and regenerate the manifest if metadata changes.\n`;
  await fs.writeFile(outputPath, contents);
}

async function createArchive() {
  await ensureDir(DIST_ROOT);
  await fs.rm(STAGING_DIR, { recursive: true, force: true });
  await ensureDir(STAGING_DIR);

  const manifestTarget = path.resolve(STAGING_DIR, 'capsule-local.mcp.json');
  await runManifest(manifestTarget);

  await copyIfExists(path.resolve(ROOT, 'capsule-local.config.json'), path.resolve(STAGING_DIR, 'capsule-local.config.json'));
  await copyIfExists(path.resolve(ROOT, 'tools', 'capsule-local.mjs'), path.resolve(STAGING_DIR, 'capsule-local.mjs'));
  await copyIfExists(path.resolve(ROOT, 'tools', 'capsule-local-sync.mjs'), path.resolve(STAGING_DIR, 'capsule-local-sync.mjs'));
  await writeReadme(path.resolve(STAGING_DIR, 'README.md'));

  try {
    await fs.rm(ARCHIVE_PATH, { force: true });
    await new Promise((resolve, reject) => {
      execFile(
        'tar',
        ['-czf', ARCHIVE_PATH, '-C', DIST_ROOT, path.basename(STAGING_DIR)],
        (error, stdout, stderr) => {
          if (stdout) {
            process.stdout.write(stdout);
          }
          if (stderr) {
            process.stderr.write(stderr);
          }
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
    console.log(`Created Capsule Local bundle at ${ARCHIVE_PATH}`);
  } catch (error) {
    console.warn('[Capsule] Failed to create tar archive automatically. Staged contents remain available.');
    console.warn(`Staged directory: ${STAGING_DIR}`);
    throw error;
  }
}

createArchive().catch((error) => {
  console.error('Capsule Local bundling failed:', error.message ?? error);
  process.exit(1);
});
