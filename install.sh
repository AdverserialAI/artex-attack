#!/usr/bin/env bash
# ARTEX 安装脚本：① 全部 Docker  ② 本地编译运行
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

info(){ printf '\033[36m[*]\033[0m %s\n' "$*"; }
ok(){   printf '\033[32m[+]\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m[!]\033[0m %s\n' "$*"; }
die(){  printf '\033[31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
ask(){  local p="$1" d="${2:-}" a; read -rp "$p${d:+ [$d]}: " a; echo "${a:-$d}"; }
rand(){ head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }

# ── docker 环境检测 / 自动安装 ───────────────────
ensure_docker(){
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Detected Docker and Docker Compose"; return
  fi
  warn "Docker / Docker Compose not detected"
  case "$(uname -s)" in
    Linux)
      if [ "$(ask 'Install Docker automatically? (y/n)' y)" = y ]; then
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update
          sudo apt-get install -y docker.io docker-compose-v2
        else
          die "Install Docker and Compose using the official instructions:https://docs.docker.com/engine/install/"
        fi
        sudo usermod -aG docker "$USER" || true
        ok "Docker installation complete (log in again after group changes to run without sudo)"
      else
        die "Install Docker manually and retry"
      fi ;;
    Darwin) die "On macOS, install Docker Desktop:https://www.docker.com/products/docker-desktop/" ;;
    *)      die "Install Docker manually and retry" ;;
  esac
}

# ── ① 全部 Docker ───────────────────────────────
install_docker(){
  ensure_docker
  # 凭据、Compose 校验、健康检查和失败诊断统一由 deploy.sh 处理，
  # 避免交互安装与常规更新使用不同的安全默认值。
  bash ./deploy.sh
  ok "Docker installation complete"
}

# ── ② 本地编译运行 ──────────────────────────────
install_local(){
  echo "Database setup:"
  echo "  1) Connect to existing PostgreSQL"
  echo "  2) Start PostgreSQL with Docker (requires Docker)"
  case "$(ask 'Select' 1)" in
    2)
      ensure_docker
      local pw; pw="$(ask 'Postgres password (Enter for random)' "$(rand)")"
      docker run -d --name artex-pg -p 5432:5432 \
        -e POSTGRES_USER=artex -e POSTGRES_PASSWORD="$pw" -e POSTGRES_DB=artex \
        -v artex-pg:/var/lib/postgresql/data postgres:16-alpine
      DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=artex DB_PASS="$pw" DB_NAME=artex DB_SSL=disable ;;
    *)
      DB_HOST="$(ask 'Database host' 127.0.0.1)"
      DB_PORT="$(ask 'Port' 5432)"
      DB_USER="$(ask 'Username' artex)"
      DB_PASS="$(ask 'Password' '')"
      DB_NAME="$(ask 'Database name' artex)"
      DB_SSL="$(ask 'sslmode (disable/require)' disable)" ;;
  esac

  # 对 Shell 无法安全表示的控制字符直接报错，其余引号/反斜杠按 JSON 转义。
  json_value(){
    local value="$1"
    [[ ! "$value" =~ [[:cntrl:]] ]] || die "Database configuration must not contain control characters"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '%s' "$value"
  }
  [[ "$DB_PORT" =~ ^[0-9]+$ ]] && [ "$DB_PORT" -ge 1 ] && [ "$DB_PORT" -le 65535 ] || die "Database port must be a number from 1 to 65535"
  case "$DB_SSL" in disable|require|verify-ca|verify-full) ;; *) die "Unsupported sslmode:$DB_SSL" ;; esac
  DB_HOST_JSON="$(json_value "$DB_HOST")"
  DB_USER_JSON="$(json_value "$DB_USER")"
  DB_PASS_JSON="$(json_value "$DB_PASS")"
  DB_NAME_JSON="$(json_value "$DB_NAME")"
  umask 077
  cat > config.json <<JSON
{
  "database": {
    "host": "${DB_HOST_JSON}",
    "port": ${DB_PORT},
    "user": "${DB_USER_JSON}",
    "password": "${DB_PASS_JSON}",
    "dbname": "${DB_NAME_JSON}",
    "sslmode": "${DB_SSL}"
  }
}
JSON
  chmod 600 config.json
  ok "Generated config.json (0600)"

  # go 环境检查
  command -v go >/dev/null 2>&1 || die "Go was not detected. Install Go >=1.26 first:https://go.dev/dl/"
  ok "Go: $(go version)"

  # 内嵌前端需要 node 出静态产物
  if command -v npm >/dev/null 2>&1; then
    . ./scripts/lib-build.sh
    build_embedded "Building static frontend…" "Compiling binary with embedded frontend…"
  else
    warn "npm not detected: compiling backend without embedded frontend (run npm run dev separately for the frontend)"
    CGO_ENABLED=0 go build -o artex ./cmd/artex
  fi
  ok "Build complete → ./artex"

  info "Starting… (Ctrl-C to exit)"
  ./artex
}

# ── 部署包校验工具（finding 63）────────────────────
# 目的：在以 root 解包之前，确认「包是预期的包」（SHA-256 / 可选签名），
# 并且「包内没有预期之外的东西」（成员白名单、无路径穿越、无链接/设备文件）。
artex_sha256(){
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    die "sha256sum/shasum not found; refusing to install without a SHA-256 check"
  fi
}

# 从 sha256sum 格式清单中取指定文件名的哈希。只接受平铺文件名，重复条目直接报错，
# 避免「同名多行」用后一行覆盖前一行造成歧义。
artex_manifest_lookup(){
  local file="$1" want="$2" line hash name found="" seen=0
  [ -r "$file" ] || die "Checksum file is not readable:$file"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [ -n "$line" ] || continue
    if [[ "$line" =~ ^([0-9a-fA-F]{64})[[:space:]]+\*?(.+)$ ]]; then
      hash="${BASH_REMATCH[1]}"; name="${BASH_REMATCH[2]}"
    else
      die "Malformed checksum line in $file (expected '<sha256>  <filename>')"
    fi
    case "$name" in */*) continue ;; esac
    if [ "$name" = "$want" ]; then
      [ "$seen" -eq 0 ] || die "Checksum file $file lists '$want' more than once"
      seen=1; found="$hash"
    fi
  done < "$file"
  [ -n "$found" ] || die "Checksum file $file has no entry for $want"
  printf '%s' "$found"
}

# 可选：gpg 分离签名校验。--key 给出公钥时强制要求签名，失败即中止。
artex_verify_signature(){
  local copy="$1" key="$2" sig="$3" home
  [ -n "$sig" ] || die "--key given but no signature (use --sig or place <package>.sig next to the package)"
  [ -f "$sig" ] || die "Signature file does not exist:$sig"
  [ -f "$key" ] || die "Public key file does not exist:$key"
  command -v gpg >/dev/null 2>&1 || die "gpg is required to verify a signed package (apt-get install -y gnupg)"
  home="$tmp/gpg-home"
  install -d -m 700 "$home"
  gpg --batch --homedir "$home" --import "$key" >/dev/null 2>&1 || die "Cannot import signing key:$key"
  gpg --batch --homedir "$home" --verify "$sig" "$copy" 2>"$tmp/gpg-verify.err" \
    || die "Package signature verification FAILED ($sig); refusing to install (details: $tmp/gpg-verify.err)"
  ok "Package signature verified ($key)"
}

# 校验 root 私有副本 copy；orig 仅用于定位旁挂的 .sha256/.sig 以及匹配清单文件名。
artex_verify_package(){
  local copy="$1" orig="$2" name expected="" source="" actual="" sig=""
  name="$(basename -- "$orig")"

  if [ "$skip_verify" -eq 1 ]; then
    warn "Insecure mode: SHA-256/signature verification is DISABLED for $name (--insecure-skip-verify)"
  else
    if [ -n "$sha_expected" ]; then
      expected="$sha_expected"; source="--sha256"
    elif [ -n "$sha_file" ]; then
      expected="$(artex_manifest_lookup "$sha_file" "$name")"; source="$sha_file"
    elif [ -f "$orig.sha256" ]; then
      expected="$(artex_manifest_lookup "$orig.sha256" "$name")"; source="$orig.sha256"
    elif [ -f ./SHA256SUMS ]; then
      expected="$(artex_manifest_lookup ./SHA256SUMS "$name")"; source="./SHA256SUMS"
    else
      die "No checksum available for $name; refusing to extract as root. Provide --sha256 <64-hex>, --sha256-file <manifest>, or ship <package>.sha256 (build.sh writes it automatically)"
    fi
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "Invalid SHA-256 value from $source (need exactly 64 hex characters)"
    expected="$(printf '%s' "$expected" | tr 'A-F' 'a-f')"
    actual="$(artex_sha256 "$copy")"
    [ "$actual" = "$expected" ] || die "SHA-256 mismatch for $name (expected $expected, got $actual); refusing to install"
    ok "SHA-256 verified ($source)"

    if [ -n "$key_file" ]; then
      sig="$sig_file"; [ -n "$sig" ] || sig="$orig.sig"
      artex_verify_signature "$copy" "$key_file" "$sig"
    elif [ -n "$sig_file" ]; then
      die "--sig requires --key <public-key>, otherwise the signature is not actually checked"
    fi
  fi

  # 成员白名单与 build.sh 的打包内容保持一致（artex / start.sh / install.sh /
  # config.example.json / skills/ / scripts/）。data/ 与 config.json 永不入包。
  python3 - "$copy" <<'PY' || die "Deployment package failed entry validation (see message above); refusing to install"
import posixpath, re, sys, tarfile

path = sys.argv[1]
exact = re.compile(r'^(artex|start\.sh|install\.sh|config\.example\.json)$')
tree = re.compile(r'^(skills|scripts)/')
root_dirs = ('skills', 'scripts')


def fail(message):
    print('package validation: ' + message, file=sys.stderr)
    raise SystemExit(1)


try:
    handle = tarfile.open(path, 'r:gz')
except tarfile.TarError as exc:
    fail('cannot read archive: %s' % exc)

with handle:
    infos = handle.getmembers()

if not infos:
    fail('archive has no entries')

# macOS 的 bsdtar/GNU tar 会把扩展属性拆成 AppleDouble 文件（平级 ._name）或
# 放进 __MACOSX/ 目录。这些只是元数据，不是安装内容；先完成路径/类型安全检查，
# 再整体忽略，既不放宽白名单，也绝不会把它们解包到 /opt/artex。
def is_apple_metadata(norm):
    return (posixpath.basename(norm).startswith('._')
            or '__MACOSX' in norm.split('/'))


entries = []
apple_metadata = 0
for info in infos:
    raw = info.name
    if any(ch in raw for ch in ('\x00', '\n', '\r', '\\')):
        fail('refusing entry with control or backslash characters: %r' % raw)
    if raw.startswith('/') or raw == '..' or raw.startswith('../') or '/../' in raw or raw.endswith('/..'):
        fail('refusing absolute or traversal path: %r' % raw)
    if info.issym() or info.islnk():
        fail('refusing link entry (symlink/hardlink): %r' % raw)
    if not (info.isfile() or info.isdir()):
        fail('refusing special or unsupported entry type: %r' % raw)
    if info.mode & 0o6000:
        fail('refusing setuid/setgid entry: %r' % raw)
    norm = posixpath.normpath(raw)
    if norm in ('.', ''):
        continue
    if norm.startswith('/') or norm == '..' or norm.startswith('../'):
        fail('refusing path escaping the archive root: %r' % raw)
    if is_apple_metadata(norm):
        apple_metadata += 1
        continue
    entries.append((norm, info.isdir()))

if not entries:
    fail('archive has no usable entries')

tops = sorted({name.split('/', 1)[0] for name, _ in entries})
strip = ''
if len(tops) == 1:
    top = tops[0]
    top_is_dir = any(is_dir and name == top for name, is_dir in entries)
    nested = any('/' in name for name, _ in entries)
    if (top_is_dir or nested) and top not in root_dirs and not exact.match(top):
        strip = top

seen = set()
have_binary = False
for name, is_dir in entries:
    if strip:
        if name == strip:
            continue
        rel = name[len(strip) + 1:] if name.startswith(strip + '/') else name
    else:
        rel = name
    if rel in seen:
        fail('duplicate entry in archive: %r' % rel)
    seen.add(rel)
    if is_dir:
        if rel in root_dirs or tree.match(rel):
            continue
        fail('directory not in allowlist: %r' % rel)
    if exact.match(rel) or tree.match(rel):
        if rel == 'artex':
            have_binary = True
        continue
    fail('file not in allowlist: %r' % rel)

if not have_binary:
    fail("archive does not contain the 'artex' binary")

print('package validation: %d entries accepted%s%s' % (
    len(seen), (' (prefix %r stripped)' % strip) if strip else '',
    (', %d AppleDouble metadata entries ignored' % apple_metadata) if apple_metadata else ''))
PY
  ok "Archive manifest validated (allowlist, no links, no traversal)"
}

# ── ③ 服务器一键部署（二进制包 + 本机 PostgreSQL）────────────────
# 非交互（幂等，可重复执行=升级）：
#   sudo ./install.sh --server [artex-xxx.tar.gz]
# 包省略时自动取当前目录最新的 artex*.tar.gz。重复执行保留 config.json/data/数据库。
#
# 完整性（finding 63）：以 root 解包前必须先能校验部署包，校验源按优先级为
#   --sha256 <64hex> > --sha256-file <manifest> > <包>.sha256（build.sh 自动生成）
#   > 当前目录 SHA256SUMS；一个都没有则拒绝安装（除非显式 --insecure-skip-verify）。
#   --key <公钥> 时额外强制校验 gpg 分离签名（--sig 或 <包>.sig），失败即中止。
#   归档成员另行校验：只允许 artex / start.sh / install.sh / config.example.json 与
#   skills/、scripts/ 子树；拒绝绝对路径、..、软/硬链接、设备/FIFO、setuid 与重复条目。
#   macOS 构建的包会带 AppleDouble 元数据（平级 ._* 与 __MACOSX/）：这些条目仍先做
#   路径/链接/类型安全检查，随后整体忽略，不参与白名单与重复检测，也不会被解包。
#
# 注意：本脚本【不创建、不管理任何系统服务】（无 systemd unit、无 enable、无自启）。
# 无论全新部署还是覆盖升级都只装文件；启动/停止/重启由用户自行负责
# （start.sh 守护 / 自建 systemd 等），脚本不再代停代起 artex.service。
install_server(){
  local pkg="" sha_expected="" sha_file="" sig_file="" key_file="" skip_verify=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --sha256)        [ "$#" -ge 2 ] || die "--sha256 requires a value"; sha_expected="$2"; shift 2 ;;
      --sha256=*)      sha_expected="${1#*=}"; shift ;;
      --sha256-file)   [ "$#" -ge 2 ] || die "--sha256-file requires a value"; sha_file="$2"; shift 2 ;;
      --sha256-file=*) sha_file="${1#*=}"; shift ;;
      --sig)           [ "$#" -ge 2 ] || die "--sig requires a value"; sig_file="$2"; shift 2 ;;
      --sig=*)         sig_file="${1#*=}"; shift ;;
      --key)           [ "$#" -ge 2 ] || die "--key requires a value"; key_file="$2"; shift 2 ;;
      --key=*)         key_file="${1#*=}"; shift ;;
      --insecure-skip-verify) skip_verify=1; shift ;;
      -h|--help)       echo "usage: sudo ./install.sh --server [--sha256 <hex>|--sha256-file <manifest>] [--key <pubkey> [--sig <sig-file>]] [--insecure-skip-verify] [artex-xxx.tar.gz]"; echo "       macOS-built packages may contain AppleDouble ._* / __MACOSX entries; they are validated, then ignored and never installed"; exit 0 ;;
      -*)              die "Unknown option:$1" ;;
      *)               [ -z "$pkg" ] || die "Only one deployment package may be given"; pkg="$1"; shift ;;
    esac
  done

  local ARTEX_DIR=/opt/artex db_pass="" db_pass_sql="" tmp src stage backup="" skills_backup="" installed=0 completed=0 pkg_copy=""
  [ "$(id -u)" = "0" ] || die "Server installation requires root:sudo ./install.sh --server"
  command -v apt-get >/dev/null 2>&1 || die "This mode supports apt-based systems (Ubuntu/Debian) only. Follow the deployment manual for other distributions"
  command -v systemctl >/dev/null 2>&1 || die "systemd was not detected"
  [ ! -L "$ARTEX_DIR" ] || die "$ARTEX_DIR is a symlink; refusing to install into it"

  # 1. 定位部署包
  if [ -z "$pkg" ]; then
    pkg="$(find . -maxdepth 1 -type f -name 'artex*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | sed -n '1s/^[^ ]* //p')"
    [ -n "$pkg" ] || die "No artex*.tar.gz deployment package in the current directory. Copy it here or specify its path:./install.sh --server /path/artex-xxx.tar.gz"
  fi
  [ -e "$pkg" ] || die "Deployment package does not exist:$pkg"
  [ -f "$pkg" ] || die "Deployment package is not a regular file:$pkg"
  [ ! -L "$pkg" ] || die "Refusing a symlinked deployment package:$pkg"
  info "Deployment package:$(realpath -- "$pkg")"

  # 1.1 以 root 私有临时目录工作：先把包复制成 0600 副本，之后只对副本校验/解包，
  #     避免校验与解包之间原文件被替换（TOCTOU）。回滚 trap 从这里开始生效。
  tmp="$(mktemp -d)"
  chmod 700 "$tmp"
  rollback_install(){
    local status=$?
    trap - EXIT
    if [ "$completed" -ne 1 ]; then
      warn "Installation failed (status $status); restoring previous deployment state…"
      if [ "$installed" -eq 1 ]; then
        if [ -n "$backup" ] && [ -f "$backup" ]; then
          cp -a "$backup" "$ARTEX_DIR/artex"
        else
          rm -f "$ARTEX_DIR/artex"
        fi
        if [ -n "$skills_backup" ] && [ -d "$skills_backup" ]; then
          rm -rf "$ARTEX_DIR/skills"
          cp -a "$skills_backup" "$ARTEX_DIR/skills"
        fi
      fi
    fi
    rm -rf "$tmp"
    exit "$status"
  }
  trap rollback_install EXIT
  pkg_copy="$tmp/artex-package.tar.gz"
  install -m 0600 -- "$pkg" "$pkg_copy"

  # 2. 系统依赖
  info "Installing system dependencies…"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    postgresql postgresql-client curl ca-certificates tar gzip python3 logrotate

  # 2.1 部署包完整性校验（finding 63）：任何失败都在改动数据库/解包之前中止。
  #     依赖上一步安装的 python3；解包只使用这里校验通过的 root 私有副本。
  artex_verify_package "$pkg_copy" "$pkg"

  # 3. PostgreSQL is ready（只本次启动，不 enable 开机自启；包管理器默认行为不受本脚本控制）
  systemctl start postgresql
  local i; for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break; sleep 1; done
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 || die "PostgreSQL is not ready"
  ok "PostgreSQL is ready"

  # 4. 库与Username（幂等；Password复用已有 config.json，否则随机生成，不落屏）
  if [ -f "$ARTEX_DIR/config.json" ]; then
    if ! db_pass="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["database"]["password"])' "$ARTEX_DIR/config.json")" || [ -z "$db_pass" ]; then
      die "Cannot read database.password from $ARTEX_DIR/config.json; aborted. The database password will never be reset after a configuration read failure"
    fi
  else
    db_pass="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
  fi
  # Password只经环境变量交给 Python，并以 SQL literal 通过 stdin 执行；不出现在 psql argv/历史中。
  db_pass_sql="$(DB_PASS="$db_pass" python3 -c 'import os; p=os.environ["DB_PASS"]; assert "\0" not in p; print("\x27" + p.replace("\x27", "\x27\x27") + "\x27")')"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$do\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'artex') THEN
    CREATE ROLE artex LOGIN;
  END IF;
END
\$do\$;
ALTER ROLE artex WITH LOGIN PASSWORD ${db_pass_sql};
SQL
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='artex'" | grep -q 1 \
    || runuser -u postgres -- createdb -O artex artex
  ok "Database artex / user artex ready (password hidden; see $ARTEX_DIR/config.json)"

  # 更新前先做一次独立数据库备份；Password只通过环境变量传给 pg_dump。
  local backup_dir="/opt/artex-backups/$(date +%Y%m%d-%H%M%S)"
  install -d -m 700 "$backup_dir"
  if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='artex'" | grep -q 1; then
    PGPASSWORD="$db_pass" pg_dump -h 127.0.0.1 -p 5432 -U artex -d artex -Fc -f "$backup_dir/artex.dump"
    chmod 600 "$backup_dir/artex.dump"
    ok "Database backed up to $backup_dir/artex.dump"
  fi

  # 5. 解包安装（保留 data/config；二进制先备份，备份只留最近 5 份）
  install -d -m 755 "$ARTEX_DIR" "$ARTEX_DIR/data"
  chmod 700 "$ARTEX_DIR/data"
  # 不做任何服务管理：不检测/停止/重启 artex.service。若旧二进制仍在运行，
  # 先由用户自行停止（或任由下面 rm + 解包替换；Linux 下解包前删除旧文件可
  # 避免覆盖正在运行的可执行文件报 ETXTBSY）。
  stage="$tmp/unpacked"
  install -d -m 700 "$stage"
  # 只解校验过的 root 私有副本；--no-same-owner/--no-same-permissions 避免包内
  # uid/gid 与 setuid 位被带到 /opt/artex，--no-overwrite-dir 不改动已存在目录的权限。
  # macOS 构建的包可能带 AppleDouble 元数据（._* / __MACOSX/）：成员校验阶段已忽略，
  # 这里再从暂存区清掉，确保它们不会进入 /opt/artex。
  tar -xzf "$pkg_copy" -C "$stage" --no-same-owner --no-same-permissions --no-overwrite-dir
  find "$stage" -name '._*' -type f -delete
  find "$stage" -depth -name '._*' -type d -delete
  find "$stage" -path '*/__MACOSX/*' -delete
  find "$stage" -depth -type d -name '__MACOSX' -delete
  if [ -n "$(find "$stage" \( -name '._*' -o -name '__MACOSX' \) -print -quit)" ]; then
    die "Package produced AppleDouble metadata after extraction; refusing to install"
  fi
  # 双保险：即便 tar 行为因版本而异，暂存区也绝不允许出现链接/设备/FIFO。
  if [ -n "$(find "$stage" ! -type d ! -type f -print -quit)" ]; then
    die "Package produced non-regular files after extraction; refusing to install"
  fi
  find "$stage" -exec chmod a-s {} +
  # 兼容「包内有单层目录」与「平铺」两种打包方式。
  src="$stage"
  if [ "$(ls -A "$stage" | wc -l)" = "1" ] && [ -d "$stage"/"$(ls "$stage")" ]; then src="$stage/$(ls "$stage")"; fi
  [ -f "$src/artex" ] || die "artex binary missing from package; invalid package structure"
  [ "$(head -c 4 "$src/artex")" = "$(printf '\177ELF')" ] || die "Packaged artex is not an ELF executable. Build a Linux binary with embedded frontend first"

  if [ -f "$ARTEX_DIR/artex" ]; then
    backup="$ARTEX_DIR/artex.bak-$(date +%Y%m%d-%H%M%S)"
    cp -a "$ARTEX_DIR/artex" "$backup"
  fi
  if [ -d "$ARTEX_DIR/skills" ]; then
    skills_backup="$tmp/skills.before"
    cp -a "$ARTEX_DIR/skills" "$skills_backup"
  fi

  # data/ 和 config.json 永远不属于程序包覆盖范围；从此时起失败会触发完整回滚。
  installed=1
  # 先删旧二进制再解包：覆盖正在运行的可执行文件会 ETXTBSY 导致安装失败；
  # unlink 后运行中的进程仍持有旧 inode，新文件照常落地（已备份，失败可回滚）。
  rm -f "$ARTEX_DIR/artex"
  (cd "$src" && tar --exclude='./data' --exclude='./config.json' -cf - .) \
    | tar -xf - -C "$ARTEX_DIR" --no-same-owner --no-same-permissions
  chmod +x "$ARTEX_DIR/artex"
  for executable in start.sh install.sh; do
    [ ! -f "$ARTEX_DIR/$executable" ] || chmod +x "$ARTEX_DIR/$executable"
  done
  # 备份只留最近 5 份；find 无匹配也返回成功，不会让 pipefail 误中断安装。
  find "$ARTEX_DIR" -maxdepth 1 -type f -name 'artex.bak-*' -printf '%T@ %p\n' \
    | sort -nr | sed -n '6,$s/^[^ ]* //p' | while IFS= read -r old; do
      [ -z "$old" ] || rm -f -- "$old"
    done
  ok "Program installed at $ARTEX_DIR"

  # 5.1 日志轮转：start.sh / nohup 都是 append 直写 artex.log，不配轮转会无限增长
  # （debug 级别下尤甚）。copytruncate 适配 append 模式，无需通知进程。
  cat > /etc/logrotate.d/artex <<'LR'
/opt/artex/artex.log {
    daily
    rotate 7
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
}
LR

  # 6. config.json（已存在则不动，避免覆盖现场配置）
  if [ ! -f "$ARTEX_DIR/config.json" ]; then
    cat > "$ARTEX_DIR/config.json" <<JSON
{
  "database": {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "artex",
    "password": "$db_pass",
    "dbname": "artex",
    "sslmode": "disable"
  },
  "skill_dir": "$ARTEX_DIR/skills"
}
JSON
    chmod 600 "$ARTEX_DIR/config.json"
    ok "Generated config.json (0600)"
  else
    info "Using existing config.json"
  fi

  # 7. 无服务处理：不创建/启用/重启任何系统服务。升级场景下旧进程仍在跑旧版本，
  #    由用户自行重启其运行方式（start.sh 守护 / 自建 systemd / supervisor）生效。

  ok "Deployment complete"
  echo "    Program directory: $ARTEX_DIR (configuration $ARTEX_DIR/config.json, 0600)"
  echo "    Log: $ARTEX_DIR/artex.log (logrotate: daily, keep 7)"
  echo "    Start: this script does not create/manage services. Run manually:"
  echo "                cd $ARTEX_DIR && nohup ./start.sh >> $ARTEX_DIR/artex.log 2>&1 &"
  echo "              For an upgrade, stop the old process before starting the new version"
  echo "              For startup at boot, create your own systemd unit; this script does not create one"
  echo "    Initial setup: open /setup to set the administrator password; configure LLM in System → LLM"
  completed=1
  trap - EXIT
  rm -rf "$tmp"
}

echo "=============================="
echo "  artex installation"
echo "  1) Full Docker installation"
echo "  2) Run locally (build with Go)"
echo "  3) Server installation (binary package + PostgreSQL; no autostart service created)"
echo "=============================="
case "${1:-}" in
  --server) shift; install_server "$@" ;;  # 非交互直连
  "") case "$(ask 'Select' 3)" in
    1) install_docker ;;
    2) install_local ;;
    3) install_server ;;
    *) die "Invalid selection" ;;
  esac ;;
  *) die "Unknown argument:$1(supports --server [--sha256 <hex>|--sha256-file <manifest>] [--key <pubkey> [--sig <sig-file>]] [--insecure-skip-verify] [package-path])" ;;
esac
