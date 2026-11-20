# 部署手册

三种方式选一，部署后都做：**/setup 设管理员密码 → 系统 → LLM 配模型**。
系统工具和预置 Agent 首启自动 seed，通常无需导入配置；只有明确需要覆盖同名配置时才使用 `./start.sh import-config ./config-export`，导入前须备份并检查其中的敏感 MCP/程序包数据。

## A. Docker（推荐）

```bash
./deploy.sh                 # 首次：自动建 .env（随机 PG 密码）→ 构建 → 启动 → 健康检查
./deploy.sh --no-build      # 已有镜像
```

- Web `:8787`，MITM 代理只绑回环 `127.0.0.1:8788`
- 数据在 `./data`、`./skills` 卷里，`down` 不删，`down -v` 删且不可恢复
- 不要换成上游 `autumn27/artex:latest`

## B. 服务器二进制（Ubuntu/Debian）

开发机构建：

```bash
./build.sh --target linux/amd64     # 产出 dist/*.deploy.tar.gz + .sha256
```

> Windows 上构建：先 `cd web && NEXT_EXPORT=1 npx next build`，`cp -r web/out server/webui/dist`，
> 再 `ARTEX_SKIP_FRONTEND=1 bash build.sh --target linux/amd64`（npm.cmd 不认 Unix 环境变量语法，rsync 常缺失）。

服务器安装（root）：

```bash
sha256sum -c *.deploy.tar.gz.sha256                  # 手工预检（install.sh 内置同样校验，属双保险）
sudo bash install.sh --server ./*.deploy.tar.gz      # 校验失败即中止，不改数据库/不解包
cd /opt/artex
setsid nohup ./start.sh >> artex.log 2>&1 < /dev/null &   # 守护启动
curl -fsS http://127.0.0.1:8787/ && echo OK
```

**安装包完整性（默认强制）**：`install.sh --server` 以 root 解包前必须先校验安装包，校验源按优先级取第一个可用的：

| 优先级 | 参数 / 文件 | 说明 |
|---|---|---|
| 1 | `--sha256 <64 位十六进制>` | 直接给出包哈希 |
| 2 | `--sha256-file <清单>` | sha256sum 格式清单，按包文件名取哈希 |
| 3 | `<包>.sha256` | 旁挂清单，`build.sh` 自动生成（默认路径） |
| 4 | `./SHA256SUMS` | 当前目录的汇总清单 |

四种都取不到、清单里没有该包、或哈希不一致时，安装**直接中止**（发生在依赖安装之后、数据库与 `/opt/artex` 变更之前）。省略包路径时仍自动选当前目录最新的 `artex*.tar.gz`，但同样必须先通过校验；目录里有多个包时请显式指定路径（只接受一个包）。

**签名校验（可选，推荐）**：加 `--key <公钥>` 即强制校验 gpg 分离签名；签名文件用 `--sig <文件>` 指定，省略时取 `<包>.sig`。缺签名、公钥导入失败或验签失败都会中止。只给 `--sig` 不给 `--key` 直接报错退出，避免“看起来校验过”。验签需要 `gpg`，其余依赖由脚本自动安装。

包内成员另有白名单：只允许 `artex`、`start.sh`、`install.sh`、`config.example.json` 与 `skills/`、`scripts/` 子树；绝对路径、`..`、软/硬链接、设备/FIFO、setuid 位和重复条目一律拒绝。

> ⚠️ 旁挂 `.sha256` 本身不签名，且与安装包走同一渠道：它能发现传输损坏或拿错文件，但**不能证明来源**——能替换包的人也能替换 `.sha256`。要防替换，必须用 `--key` + 通过独立渠道分发的公钥（当前发布流水线的 cosign 签名只覆盖容器镜像，不覆盖服务器部署包）。

> 逃生口：`--insecure-skip-verify` 跳过哈希/签名校验（仍检查成员白名单），并打印 Insecure mode 警告。仅用于完全离线、且已用其他方式确认包来源的恢复场景；不要写进脚本或 CI。

安装脚本自动装 PostgreSQL、建库、备份旧数据，装到 `/opt/artex`；**不建 systemd 服务**，
开机自启需自建 unit。

## C. 本地源码

```bash
./install.sh    # 选 2：连已有 PG 或用 Docker 临时起，生成 config.json，构建并运行
```

## 常用维护

| 事项 | 命令 |
|---|---|
| 升级（Docker） | `./update.sh` |
| 升级（二进制） | 重跑 `sudo bash install.sh --server <新包>`（校验通过后自动备份） |
| 配置迁移 | 见《换环境迁移》，`export-config` / `import-config`（需 `ARTEX_DB_URL`） |
| 忘记密码 | `reset-password.sh` |
| 看日志 | `/opt/artex/artex.log`（已配 logrotate，留 7 天） |

## 排障

| 现象 | 处理 |
|---|---|
| 启动循环刷 `bind: address already in use` | 8787/8788 被占：`ss -tlnp \| grep 8787` 找到旧进程，按 PID 停掉（勿用朴素 `pkill -f`，会杀掉自身 ssh） |
| 迁移命令报 `role "root" does not exist` | 没设 `ARTEX_DB_URL`，见《换环境迁移》 |
| 已有 PG 集群上装 | 注意：脚本会重置 `artex` 角色密码，共用该角色的其他应用会断 |

## 安全底线

- Web 默认绑所有网卡：限制来源 + 反代 + TLS 后再对外
- `.env`、`config.json`、`data/`、`jwt.key`、LLM key 按秘密管理，不进仓库
- 服务器部署包须先通过 `.sha256` 或 `--key` 签名校验再安装；`--insecure-skip-verify` 只作离线恢复的显式例外
