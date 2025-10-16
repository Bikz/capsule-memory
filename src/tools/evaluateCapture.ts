#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  scoreConversationEvent,
  type CaptureScoreOptions,
  type ConversationEvent
} from '@capsule/core';

type DatasetEntry = ConversationEvent & {
  expected: boolean;
  note?: string;
  category?: string;
};

type EvalArgs = CaptureScoreOptions & {
  dataset?: string;
  json?: boolean;
  csv?: string;
};

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--dataset':
      case '-d':
        args.dataset = argv[++i];
        break;
      case '--threshold':
      case '-t':
        args.threshold = Number.parseFloat(argv[++i]);
        break;
      case '--json':
        args.json = true;
        break;
      case '--csv':
        args.csv = argv[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(
    `Capsule Capture Evaluator\n\nUsage: pnpm run eval:capture -- --dataset datasets/capture-samples.json [--threshold 0.6] [--json] [--csv results.csv]\n`
  );
}

async function loadDataset(datasetPath: string): Promise<DatasetEntry[]> {
  const resolved = path.resolve(process.cwd(), datasetPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Dataset must be an array of conversation events.');
  }
  return data.map((entry, index) => ({
    id: entry.id ?? `event-${index}`,
    role: entry.role,
    content: entry.content,
    metadata: entry.metadata,
    expected: Boolean(entry.expected),
    note: entry.note,
    category: entry.category
  }));
}

function toCsvRow(values: Array<string | number | boolean | null | undefined>): string {
  return values
    .map((value) => {
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    })
    .join(',');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dataset) {
    printHelp();
    process.exit(1);
  }

  const dataset = await loadDataset(args.dataset);
  const threshold = typeof args.threshold === 'number' ? args.threshold : 0.6;

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const results = dataset.map((entry) => {
    const score = scoreConversationEvent(entry, { threshold });
    const predicted = score.recommended;
    const actual = entry.expected;

    if (predicted && actual) {
      truePositives += 1;
    } else if (predicted && !actual) {
      falsePositives += 1;
    } else if (!predicted && actual) {
      falseNegatives += 1;
    }

    return {
      id: entry.id,
      role: entry.role,
      content: entry.content,
      expected: actual,
      predicted,
      score: Number(score.score.toFixed(3)),
      category: score.category,
      reasons: score.reasons,
      note: entry.note ?? null
    };
  });

  const precision =
    truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const summary = {
    datasetSize: dataset.length,
    threshold,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1: Number(f1.toFixed(3)),
    truePositives,
    falsePositives,
    falseNegatives,
    results
  };

  if (args.csv) {
    const csvLines = ['id,role,expected,predicted,score,category,reasons,note'];
    for (const result of results) {
      csvLines.push(
        toCsvRow([
          result.id,
          result.role,
          result.expected,
          result.predicted,
          result.score,
          result.category,
          result.reasons.join('; '),
          result.note ?? ''
        ])
      );
    }
    await fs.writeFile(path.resolve(process.cwd(), args.csv), `${csvLines.join('\n')}\n`);
    console.log(`Wrote CSV results to ${args.csv}`);
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.table(
      results.map((result) => ({
        id: result.id,
        role: result.role,
        expected: result.expected,
        predicted: result.predicted,
        score: result.score,
        category: result.category,
        reasons: result.reasons.join(' | ')
      }))
    );
    console.log('\nSummary');
    console.table([
      {
        threshold,
        precision: summary.precision,
        recall: summary.recall,
        f1: summary.f1,
        truePositives,
        falsePositives,
        falseNegatives
      }
    ]);
  }
}

run().catch((error) => {
  console.error('Capture evaluation failed:', error);
  process.exit(1);
});
