# ARTEX Attack

<img src="web/public/logo.png" alt="ARTEX Attack logo" width="180" />

ARTEX Attack is the AdverserialAI-maintained, English-language fork of ARTEX for
authorized autonomous penetration testing and security research. It combines a
planner/worker execution model with scenario templates, intent review, custom agents,
finding orchestration, and confidential hosted model access.

Clone, release, and source links refer to `AdverserialAI/artex-attack`.

> Use ARTEX Attack only on systems you own or are explicitly authorized to test.
> Review and interception controls support operator judgment; they do not create
> authorization or make an unsafe target suitable for testing.

## What this fork adds

- **English runtime and interface:** menus, task flows, defaults, prompts, generated
  reports, notifications, validation errors, and operational logs render in English.
  Legacy Chinese database keys remain accepted so existing installations can migrate.
- **Configurable scenarios:** task categories can select planner and worker templates,
  review defaults, asset modes, and an optional seed intent.
- **Reviewable intents:** AI pre-screening and human approval/rejection can gate work
  before an executor runs it.
- **Selectable executors:** tasks and intents can use built-in workers or custom agents.
- **Finding orchestration:** confirmed findings can create focused subtasks, reports,
  evidence handoffs, and independent retests.
- **Confidential model provisioning:** hosted agents receive only a short-lived local
  capability for an in-VM model proxy. The external provider key stays in the proxy.
- **Managed hosted mode:** the LLM settings menu is hidden when the model is controlled
  by the confidential runtime, and model configuration can reload without restarting
  ARTEX.
- **Hardened updates:** the legacy upstream binary downloader and self-replacement path
  are removed. Hosted installations update by deploying a reviewed image digest.
- **Verifiable releases:** version tags build a Linux AMD64 image with SBOM and
  provenance, sign its digest with keyless Sigstore, and publish the immutable image
  reference in a GitHub release.

Enhancements that affect task behavior remain opt-in unless a task or deployment
selects them.

## Quick start

### Docker Compose from source

```bash
git clone https://github.com/AdverserialAI/artex-attack.git
cd artex-attack
chmod +x deploy.sh
./deploy.sh
```

The first run creates `.env` with mode `0600` and a random PostgreSQL password. An
existing `.env` is preserved. To reuse an existing local image, run
`./deploy.sh --no-build`.

### Build from source

```bash
git clone https://github.com/AdverserialAI/artex-attack.git
cd artex-attack
chmod +x build.sh
./build.sh

export ARTEX_PG_DSN='postgres://artex:YOUR_PASSWORD@127.0.0.1:5432/artex?sslmode=disable'
./dist/artex-linux-amd64/artex
```

The build requires Go 1.26.11 or newer and Node.js 22 or newer.

### Use a signed release

Every maintained release lists a digest-pinned Artifact Registry image and its exact
Cosign verification command on the [Releases](https://github.com/AdverserialAI/artex-attack/releases)
page. Confidential deployments must use `repository@sha256:...`, never a mutable tag.
Releases also attach an exact digest-pinned Compose file, machine-readable release
manifest, and checksums for confidential-runtime measurement policy.

## First use

1. Open `http://<server-IP>:8787/setup` and set the administrator password.
2. For a local installation, configure a model under **System → LLM**. Anthropic,
   OpenAI, and compatible private gateways are supported.
3. Open **Tasks → New task**, choose the scenario and planner, enter an authorized
   target and goal, and create the task.

Hosted confidential agents receive their model through the runtime bootstrap and do
not expose editable provider credentials in the ARTEX interface.

## Confidential hosted model access

Set `ARTEX_LLM_BOOTSTRAP_FILE` to the protected runtime document provisioned under
`/run/adverserial/current`. In managed mode ARTEX:

1. accepts only the fixed `http://model-proxy:8089` origin;
2. reads a local capability token from a protected runtime file;
3. removes direct provider credentials and endpoints from application configuration;
4. fails closed on unsafe paths, permissions, URLs, or incomplete configuration; and
5. reloads the model after the owner connects one without exposing the provider key.

The proxy holds the external key and injects it only when forwarding the request.
See [Confidential SaaS LLM](docs/CONFIDENTIAL-SaaS-LLM.md).

## Administration

| Action | Command |
| --- | --- |
| Start a binary installation | `cd /opt/artex && ./start.sh` |
| Update a Docker deployment | Deploy a newly verified digest or run `./update.sh` for a source-managed local installation |
| Reset the administrator password | `./reset-password.sh` |
| Export configuration | `./start.sh export-config <directory>` |
| Import configuration | `./start.sh import-config <directory>` |

ARTEX does not download or replace its own executable. Verify and deploy a new release
through your normal image or package management process.

## Optional MCP integrations

Install only the integrations needed for the authorized engagement, then grant them
agent visibility under **System → MCP**.

| MCP | Purpose | Project |
| --- | --- | --- |
| GodzillaSuper | Webshell management and foothold connection checks used by trace cleanup | [Xaaaa-bip/GodzillaSuper](https://github.com/Xaaaa-bip/GodzillaSuper) |
| Playwright MCP | Browser operations, asset discovery, and screenshots as evidence | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) |
| ScopeSentry | Asset discovery synchronization | [DoubleShark/ScopeSentry](https://github.com/DoubleShark/ScopeSentry) |

## Documentation

| Document | Link |
| --- | --- |
| Confidential model bootstrap | [Confidential SaaS LLM](docs/CONFIDENTIAL-SaaS-LLM.md) |
| Release and image verification | [Releasing ARTEX Attack](docs/RELEASING.md) |
| Architecture | [Architecture](ARCHITECTURE.md) |
| Release history | [Changelog](CHANGELOG.md) |

Some historical implementation documents retain their original filenames for stable
links. Runtime-facing content is translated independently of those filenames.

## Upstream and license

ARTEX Attack is derived from [Autumn-27/artex](https://github.com/Autumn-27/artex) and
later community work. Upstream copyright and attribution are preserved.

Licensed under the [GNU Affero General Public License v3.0](LICENSE). Network users
must be offered the corresponding source as required by AGPL-3.0. Third-party
components retain their own licenses and notices.
