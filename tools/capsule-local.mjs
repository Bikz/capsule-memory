#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'capsule-local.db');
const DEFAULT_PORT = Number.parseInt(process.env.CAPSULE_LOCAL_PORT ?? '5151', 10);
const DEFAULT_CONFIG_PATH = process.env.CAPSULE_LOCAL_CONFIG ||
  path.resolve(process.cwd(), 'capsule-local.config.json');

sqlite3.verbose();

function initDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, '');
  }
  const db = new sqlite3.Database(dbPath);
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        pinned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        tags TEXT,
        metadata TEXT
      )
    `);
  });
  return db;
}

async function loadConfig(configPath) {
  try {
    const raw = await fsPromises.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      serviceName: parsed.serviceName || 'Capsule Local',
      description:
        parsed.description ||
        'Local-first Capsule Memory cache for offline use and MCP integrations.',
      defaultSubjectId: parsed.defaultSubjectId || 'local-operator',
      defaultTags: Array.isArray(parsed.defaultTags)
        ? parsed.defaultTags.filter((value) => typeof value === 'string' && value.trim().length > 0)
        : [],
      manifest: parsed.manifest || {}
    };
  } catch (error) {
    return {
      serviceName: 'Capsule Local',
      description: 'Local-first Capsule Memory cache for offline use and MCP integrations.',
      defaultSubjectId: 'local-operator',
      defaultTags: [],
      manifest: {}
    };
  }
}

function listMemories(db, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM memories ORDER BY pinned DESC, datetime(created_at) DESC LIMIT ?',
      [limit],
      (error, rows) => {
        if (error) {
          reject(error);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

function insertMemory(db, record) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO memories (id, content, pinned, created_at, tags, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [
        record.id,
        record.content,
        record.pinned ? 1 : 0,
        record.created_at || new Date().toISOString(),
        JSON.stringify(record.tags ?? []),
        JSON.stringify(record.metadata ?? {})
      ],
      (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}

function makeResponse(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function startLocalServer(db, port, config) {
  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url || '', true);
    if (req.method === 'GET' && parsed.pathname === '/local/memories') {
      try {
        const limit = parsed.query.limit ? Number.parseInt(`${parsed.query.limit}`, 10) : 20;
        const memories = await listMemories(db, limit);
        makeResponse(res, 200, { data: memories });
      } catch (error) {
        makeResponse(res, 500, { error: String(error) });
      }
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/local/memories') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const payload = raw ? JSON.parse(raw) : {};
          if (!payload.id || !payload.content) {
            makeResponse(res, 400, { error: 'id and content are required' });
            return;
          }
          const enriched = {
            ...payload,
            metadata: {
              ...(payload.metadata || {}),
              service: 'capsule-local'
            },
            tags: Array.isArray(payload.tags)
              ? Array.from(new Set([...config.defaultTags, ...payload.tags]))
              : config.defaultTags
          };
          await insertMemory(db, enriched);
          makeResponse(res, 201, { ok: true });
        } catch (error) {
          makeResponse(res, 500, { error: String(error) });
        }
      });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/local/status') {
      makeResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/local/manifest') {
      makeResponse(res, 200, {
        data: {
          name: config.serviceName,
          description: config.description,
          endpoint: `http://localhost:${port}/local/memories`,
          ...config.manifest
        }
      });
      return;
    }

    makeResponse(res, 404, { error: 'Not found' });
  });

  server.listen(port, () => {
    console.log(`${config.serviceName} listening on http://localhost:${port}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Capsule Local Service
Usage: pnpm run local
Environment:
  CAPSULE_LOCAL_DB   path to SQLite db (default: ${DEFAULT_DB_PATH})
  CAPSULE_LOCAL_PORT port for local API (default: ${DEFAULT_PORT})
`);
    process.exit(0);
  }

  const dbPath = process.env.CAPSULE_LOCAL_DB || DEFAULT_DB_PATH;
  const port = DEFAULT_PORT;
  const config = await loadConfig(DEFAULT_CONFIG_PATH);

  const db = initDatabase(dbPath);
  startLocalServer(db, port, config);
}

main().catch((error) => {
  console.error('Capsule Local failed:', error);
  process.exit(1);
});
