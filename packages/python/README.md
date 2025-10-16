# Capsule Memory Python Client

A lightweight HTTP wrapper around Capsule Memory's REST API. The interface mirrors the Node SDK and now includes the
capture-review helpers for scoring conversation events and handling the approval queue.

## Installation

```bash
pip install -e .
```

(From the `packages/python` directory.)

## Usage

```python
from capsule_memory import CapsuleMemoryClient

client = CapsuleMemoryClient(
    base_url="https://capsule.example.com",
    api_key="demo-key",
    org_id="demo-org",
    project_id="demo-project",
    default_subject_id="local-operator",
)

# Store a memory
client.store_memory(content="Alex prefers meetings on Tuesdays", pinned=True, retention="irreplaceable")

# Fetch pending capture candidates and approve the first one
candidates = client.list_capture_candidates(status="pending")
if candidates:
    client.approve_capture_candidate(candidates[0].id)
```

## Available helpers

- `store_memory`, `list_memories`, `search` – parity with the Node SDK.
- `score_capture(events, threshold)` – evaluate conversation events and queue recommended memories.
- `list_capture_candidates(status='pending')` – inspect the review queue.
- `approve_capture_candidate(id, overrides=None)` / `reject_capture_candidate(id, reason=None)` – resolve queued items.

Requests are made with the standard `requests` library; you can pass a preconfigured `requests.Session` to
`CapsuleMemoryClient` if you need custom proxies, retry adapters, or shared cookies.
