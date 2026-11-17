# artex-ld

Current version: **0.1.5** · Release: **artex-ld 0.1.5** · Git tag: **v0.1.5**.

An autonomous AI penetration testing platform derived from [ARTEX](https://github.com/autumn27/artex) v0.3.15+.

This fork extends the planner/worker workflow with four controls: **configurable scenarios** (task categories, templates, and seed intents), **reviewable intents** (AI pre-screening and human approval/rejection), **selectable executors** (custom agents), and **finding orchestration** (triggers for subtasks, reports, and retests). Enhancements are disabled by default; when unused, the upstream behavior is retained.

> Use only with legal authorization, systems you own, or isolated test environments. Review, interception, and human confirmation assist operators; they do not replace authorization boundaries, target isolation, or operator judgment.

## Quick start

### Option 1: Release deployment package

The deployment package includes automatic PostgreSQL initialization.

```bash
# 1. Create a directory and download the package.
mkdir artex && cd artex
wget https://github.com/IcebergN2026/artex-ld/releases/download/0.1.5/artex-0.1.5-linux-amd64.deploy.tar.gz

# 2. Extract and install.
tar xzf artex-0.1.5-linux-amd64.deploy.tar.gz
chmod +x install.sh
sudo bash install.sh --server artex-0.1.5-linux-amd64.deploy.tar.gz
```

The installer installs files and initializes the database. It does not create or manage an autostart service. Start the application with `/opt/artex/start.sh`, or configure your own service. For an upgrade, stop the old application process before starting the new version.

### Option 2: Docker Compose from source

```bash
git clone https://github.com/IcebergN2026/artex-ld.git
cd artex-ld
chmod +x deploy.sh && ./deploy.sh
# Reuse an existing image without rebuilding:
# ./deploy.sh --no-build
```

The first run creates `.env` with permissions `0600` and a random PostgreSQL password. An existing `.env` is preserved.

### Option 3: Build from source

```bash
git clone https://github.com/IcebergN2026/artex-ld.git
cd artex-ld
chmod +x build.sh
./build.sh  # Requires Go 1.26.11+ and Node.js 22+.
export ARTEX_PG_DSN='postgres://artex:YOUR_PASSWORD@127.0.0.1:5432/artex?sslmode=disable'
./dist/artex-linux-amd64/artex
```

## Administration

| Action | Command |
| --- | --- |
| Start the binary installation | `cd /opt/artex && ./start.sh` |
| Update Docker deployment | `./update.sh` |
| Update a binary installation | Run `install.sh --server <new-package>` again; it backs up the database and old binary |
| Reset the administrator password | `./reset-password.sh` |

## First use

1. Open `http://<server-IP>:8787/setup` and set the administrator password.
2. Configure your model in **System → LLM**. Anthropic, OpenAI, and OpenAI-compatible private gateways are supported.
3. Open **Tasks → New task**, select a scenario category and planner template, enter the target and goal, and create the task.

## Optional MCP integrations

Some scenario capabilities depend on the following MCP servers. Install them as needed, then configure them and grant agent visibility in **System → MCP**.

| MCP | Purpose | Project | Installation / startup |
| --- | --- | --- | --- |
| **GodzillaSuper** | Webshell management and real foothold connection checks (`shell_list` / `shell_test`); used by trace cleanup | [Xaaaa-bip/GodzillaSuper](https://github.com/Xaaaa-bip/GodzillaSuper) | Java 17+. Download `gsl5.jar` from its releases, then run `java -jar gsl5.jar mcp 9123 127.0.0.1`. SSE URL: `http://127.0.0.1:9123/sse` |
| **Playwright MCP** | Browser operations, asset discovery, and screenshots as evidence | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | `npx @playwright/mcp --headless` |
| **ScopeSentry** | Asset discovery synchronization | [DoubleShark/ScopeSentry](https://github.com/DoubleShark/ScopeSentry) | Follow its README for Docker deployment. Connect over HTTP using an API key generated in ScopeSentry |

## Documentation

| Document | Link |
| --- | --- |
| Feature guide: agents, tools, review workflow, and examples | [Feature guide](docs/ARTEX-二开功能详解.md) |
| Dependencies, offline builds, upgrades, and reverse proxies | [Deployment manual](docs/ARTEX-部署手册.md) |
| Migration between environments | [Environment migration](docs/ARTEX-换环境迁移方案.md) |
| End-to-end implementation reference | [Implementation reference](docs/ARTEX-二开-全流程代码链文档.md) |
| Release history | [Changelog](CHANGELOG.md) |
| Confidential SaaS model-provider bootstrap | [Confidential SaaS LLM](docs/CONFIDENTIAL-SaaS-LLM.md) |

## Follow LDsec

Follow **LDsec** on WeChat for version updates, case studies, and usage tips.

![LDsec WeChat QR code](docs/images/wechat-qrcode.jpg)

## License

[AGPL v3](LICENSE), following the upstream license. Modifications do not remove the copyright or licensing obligations of upstream or third-party components.
