---
title: REST API
description: Reference for the Capsule Memory `/v1` REST surface.
---

Capsule Memory exposes a REST interface under `/v1`. All requests require an API key plus tenancy headers.

## Authentication headers

| Header | Required | Description |
| ------ | -------- | ----------- |
| `X-Capsule-Key` | Yes | API key created for the project. |
| `X-Capsule-Org` | Yes | Organisation identifier. |
| `X-Capsule-Project` | Yes | Project identifier. |
| `X-Capsule-Subject` | Yes | Subject (agent/user) whose memories are being accessed. |

## Create memory

```http
POST /v1/memories
Idempotency-Key: <optional>
Content-Type: application/json
```

```json
{
  "content": "Follow up with Lana on Tuesday",
  "pinned": false,
  "tags": ["sales"],
  "ttlSeconds": 604800
}
```

Response:

```json
{
  "id": "65f...",
  "orgId": "acme",
  "projectId": "assistant",
  "subjectId": "rep-42",
  "pinned": false,
  "createdAt": "2024-03-10T16:32:11.512Z",
  "tags": ["sales"],
  "expiresAt": "2024-03-17T16:32:11.512Z",
  "explanation": "Memory saved successfully.",
  "forgottenMemoryId": null
}
```

## Search memories

```http
POST /v1/memories/search
Content-Type: application/json
```

```json
{
  "query": "follow up",
  "limit": 5
}
```

## List, pin, and delete

- `GET /v1/memories?limit=20&tag=sales`
- `PATCH /v1/memories/{id}` with `{ "pinned": true, "ttlSeconds": null }`
- `DELETE /v1/memories/{id}` with optional `{ "reason": "Merged into CRM" }`

All responses return structured explanations so orchestration layers can audit changes.
