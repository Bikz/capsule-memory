# Capsule Memory Cloud Overlay

This directory houses the private artifacts that extend the open-source Capsule Memory project into the fully-managed cloud
service. The public repository contains the engine, Studio UI, SDKs, CLI tooling, and self-host docs. Everything under
`cloud/` is intentionally lightweight and can be mirrored into a private repo where the production team adds the proprietary
layers.

## Repository layout

```
cloud/
  README.md              # this guide
  services/              # multi-tenant provisioning, billing, usage analytics, SSO/SCIM, etc.
  connectors/            # managed connector workers (OAuth credentials, ingestion schedulers)
  admin/                 # internal control plane UI, support tooling, incident dashboards
  infra/                 # infrastructure-as-code, CI/CD pipelines, monitoring, secrets management
  docs/                  # runbooks, SOPs, private API contracts, oncall guides
```

Each directory currently contains a placeholder `.gitkeep` so the structure is versioned. In the private cloud repo you can
either:

1. **Use a submodule** – add this OSS repository as a submodule and keep `cloud/` in the private repo with real
   implementations.
2. **Import packages** – install the published `@capsule-memory/*` packages and treat this folder as a template for the
   proprietary layers.

## Suggested workflow

1. Clone the public repo (`capsule-memory`) for the core engine and UI.
2. Create a private repository (`capsule-memory-cloud`) and add this project as a submodule under `oss/` (or depend on the
   published packages).
3. Copy the `cloud/` directory structure and replace these placeholders with real code:
   - `services/` – tenancy provisioning, usage metering, billing, SSO/SAML, audit exports.
   - `connectors/` – managed ingestion pipelines with OAuth token rotation, delta syncing, compliance checks.
   - `admin/` – internal dashboards for support, approvals, manual overrides, customer success tooling.
   - `infra/` – Terraform/Kubernetes manifests, GitHub Actions/Argo pipelines, observability stacks, run-time configs.
   - `docs/` – sensitive runbooks, incident guides, escalation procedures.
4. Keep an `oss-version.txt` (or similar) in the private repo to track which commit/tag of the open-source project is in use.
5. Publish cloud-only libraries or Docker images from the private repo while contributing engine/UI improvements upstream.

## Keeping OSS and Cloud in sync

- Ship changes to the core engine, Studio, or SDKs in the public repo.
- Bump the reference in the private repo and run integration tests that cover billing, ingestion, and governance workflows.
- Commit any cloud-specific adjustments under the `cloud/` directories without polluting the open-source history.
- Automate checks to ensure public APIs remain backward compatible before promoting releases to the managed service.

This separation lets the community run Capsule Memory locally or self-host, while your hosted offering layers on enterprise
features, managed connectors, and operational tooling.
