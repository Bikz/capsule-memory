# Cloud vs Open-Source Structure

The Capsule Memory project is intentionally split into two layers:

## Open Source (this repo)

- **Engine & APIs** – retrieval runtime, capture scoring, retention policies, REST routes.
- **Capsule Studio** – UI shell for recipes, policies, connectors, and capture review.
- **SDKs & CLI** – Node, Python, MCP bridge, evaluation tooling, local scripts.
- **Docs & Examples** – quickstarts, datasets, connector stubs, self-host guidance.
- **Local tooling** – Capsule Local service, bundle/manifest scripts, metrics reporters.

## Cloud Overlay (`cloud/`)

Private-only code lives under the `cloud/` directory (or a separate private repo) and typically includes:

| Area        | Description                                                                 |
|-------------|-----------------------------------------------------------------------------|
| services/   | Multi-tenant provisioning, billing, usage metering, SSO/SAML/SCIM, key mgmt |
| connectors/ | Managed OAuth connectors, ingestion pipelines, token rotation, compliance   |
| admin/      | Support dashboards, approvals, incident tooling, internal analytics         |
| infra/      | Terraform/Kubernetes manifests, pipelines, observability configs             |
| docs/       | Runbooks, SOPs, escalation guides, private API contracts                     |

## Recommended repository layout

```
capsule-memory/             # public repo (this one)
  src/
  packages/
  docs/
  tools/
  cloud/                    # empty scaffolding; real code lives in private repo

capsule-memory-cloud/       # private repo
  oss/                      # submodule or vendored copy of capsule-memory
  cloud/                    # proprietary services/connectors/admin/infra/docs
  oss-version.txt           # tracks upstream commit hash/tag
  Makefile / pipelines      # build + release workflows for managed service
```

## Workflow tips

1. **Upstream first** – feature work that benefits the community lands in `capsule-memory` and is tagged for releases.
2. **Promote downstream** – the private repo pulls the new tag, runs integration tests, and publishes managed artifacts.
3. **Environment parity** – use the same Studio UI/components in both editions; guard cloud-only tabs/features behind
   environment checks or feature flags.
4. **Docs & configuration** – keep self-host docs open; place customer-specific or sensitive documentation under `cloud/docs/`.
5. **Security** – avoid storing production secrets in the public repo; use the private overlay for secrets management and secure pipeline configuration.

Following this structure keeps the open-source community empowered while enabling a differentiated hosted product.
