---
title: MCP Integration
description: Use Capsule Memory inside MCP-compatible agent runtimes.
---

The `@capsule-memory/mcp` package exposes Capsule Memory as an [MCP](https://modelcontextprotocol.io/) tool collection.

## Installation

```bash
npx @capsule-memory/mcp
```

The CLI starts an stdio server that advertises the following tools:

- `capsule-memory.store`
- `capsule-memory.search`
- `capsule-memory.list`
- `capsule-memory.pin`
- `capsule-memory.forget`

## Configuration

Set environment variables before launching the CLI:

```bash
export CAPSULE_MEMORY_URL="https://api.capsulememory.com"
export CAPSULE_API_KEY="prod-key"
export CAPSULE_DEFAULT_ORG_ID="acme"
export CAPSULE_DEFAULT_PROJECT_ID="assistant"
export CAPSULE_DEFAULT_SUBJECT_ID="support-agent"
```

Point your MCP host (Claude Desktop, etc.) at the generated manifest to let the agent persist and retrieve long-term memories via the production API.
