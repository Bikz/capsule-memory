#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { randomUUID } from 'node:crypto';

const DEFAULT_DB_PATH = process.env.CAPSULE_LOCAL_DB || path.resolve(process.cwd(), 'capsule-local.db');

sqlite3.verbose();

function openDatabase(dbPath) {
  return new sqlite3.Database(dbPath);
}

function ensureSchema(db) {
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
}

function fetchAllMemories(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM memories ORDER BY datetime(created_at) DESC', [], (error, rows) => {
      if (error) {
        reject(error);
      } else {
        resolve(rows ?? []);
      }
    });
  });
}

function upsertMemory(db, record) {
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--export':
        args.exportPath = argv[++i];
        break;
      case '--import':
        args.importPath = argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capsule Local Data CLI\n\nUsage:\n  pnpm run local:data -- --export backup.json\n  pnpm run local:data -- --import backup.json\n\nFlags:\n  --export <path>  Write all local memories to the provided JSON file.\n  --import <path>  Load memories from a JSON file (array of records).\n`);
}

async function exportMemories(db, exportPath) {
  const records = await fetchAllMemories(db);
  const resolved = path.resolve(process.cwd(), exportPath);
  await fs.writeFile(resolved, JSON.stringify(records, null, 2));
  console.log(`Exported ${records.length} memories to ${resolved}`);
}

async function importMemories(db, importPath) {
  const resolved = path.resolve(process.cwd(), importPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Import file must contain an array of memory records.');
  }

  let imported = 0;
  for (const entry of data) {
    if (!entry || typeof entry.content !== 'string') {
      continue;
    }
    const record = {
      id: entry.id && typeof entry.id === 'string' ? entry.id : randomUUID(),
      content: entry.content,
      pinned: Boolean(entry.pinned),
      created_at: entry.created_at,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}
    };
    await upsertMemory(db, record);
    imported += 1;
  }

  console.log(`Imported ${imported} memories from ${resolved}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.exportPath && !args.importPath)) {
    printHelp();
    if (!args.help) {
      process.exit(1);
    }
    return;
  }

  const db = openDatabase(DEFAULT_DB_PATH);
  ensureSchema(db);

  try {
    if (args.exportPath) {
      await exportMemories(db, args.exportPath);
    }
    if (args.importPath) {
      await importMemories(db, args.importPath);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('Capsule Local data command failed:', error.message ?? error);
  process.exit(1);
});
