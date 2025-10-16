# @capsule/mcp

Model Context Protocol (MCP) tool that exposes Capsule Memory's API to MCP-compatible agents. It wraps the Modelence backend and forwards requests to `/v1/memories` while handling authentication and tenant scoping headers automatically.

## Usage

```bash
npx @capsule/mcp
```

The CLI communicates over stdio. Point your MCP client at the generated manifest to gain access to the `capsule-memory.store`, `capsule-memory.search`, `capsule-memory.list`, `capsule-memory.pin`, and `capsule-memory.forget` tools.

## Environment

- `CAPSULE_MEMORY_URL` – Base URL for the Capsule Memory server (defaults to `http://localhost:3000`).
- `CAPSULE_DEFAULT_ORG_ID` / `CAPSULE_DEFAULT_PROJECT_ID` / `CAPSULE_DEFAULT_SUBJECT_ID` – Override tenant defaults.
- `CAPSULE_API_KEY` – API key when the server enforces `/v1` authentication.

## Development

The executable entry lives at `src/index.mjs`. The root repository's `pnpm run mcp` script delegates to this package for backwards compatibility.
