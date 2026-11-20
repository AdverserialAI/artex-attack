// auth.go：JWT 登录认证与密码管理（密钥加载、签发、校验、鉴权中间件与认证接口）。
// 主要函数/类型：
//   - loadOrCreateJWTKey：加载或生成 JWT 签名密钥。
//   - deriveJWTKey / signJWTSession / parseJWT / verifyJWT / extractToken：签发 / 校验 / 从请求提取 JWT。
//   - loadTokenVersion / bumpTokenVersion：持久化 token epoch，改密时吊销此前签发的全部 token。
//   - requireAuth：鉴权中间件，拦截未认证请求。
//   - authInit / authLogin / authRefresh / authChangePassword / authStatus：初始化 / 登录 / 续期 / 改密 / 认证状态接口。

package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	jwtKeyFilename = "jwt.key"
	authPassKey    = "auth.password_hash"
	// authTokenVersionKey 持久化 token epoch（单调递增）。改密时自增，并把新值折进
	// HS256 签名密钥（deriveJWTKey），让此前签发的所有 token 立即验签失败——无需在
	// 每个请求上查询 denylist，也不给 token 增加一个可被重新解析/伪造的版本字段。
	authTokenVersionKey = "auth.token_version"

	// jwtTTL 是访问 token 的有效期。此前固定 7 天：token 一旦泄露（浏览器历史、
	// Referer、日志、备份），攻击者可在整整一周内以管理员身份调用 API，而服务端
	// 没有任何吊销手段。1 小时 + /api/auth/refresh 轮换把暴露窗口压到小时级。
	jwtTTL = time.Hour
	// jwtSessionTTL 是绝对会话上限（自首次登录起算）。refresh 只能在该窗口内换新，
	// 不能无限续期，否则"偷到一次 token"依旧等于永久管理员权限。
	jwtSessionTTL = 12 * time.Hour

	keyChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

	// 下限与 setup 页的前端校验一致——校验只放在前端等于没放，直接打 API 就能
	// 绕过。上限是 bcrypt 的硬限制：超过 72 字节 GenerateFromPassword 会返回
	// ErrPasswordTooLong，提前挡掉好过让用户收到一句含义不明的「Failed to hash password」。
	minPasswordRunes = 8
	maxPasswordBytes = 72
)

// errDataSourceUnavailable 是密码相关读操作失败时统一的回复。这些 handler 绝不能
// 把"读不到"当成"没有设置"：authInit 曾因此在数据库报错时放行，让未认证请求覆盖
// 掉已有的管理员密码。
const errDataSourceUnavailable = "Data source temporarily unavailable. Please try again later"

// validatePassword 返回空串表示通过，否则返回可直接展示给用户的中文原因。
func validatePassword(pw string) string {
	if utf8.RuneCountInString(pw) < minPasswordRunes {
		return fmt.Sprintf("Password must contain at least %d characters", minPasswordRunes)
	}
	if len(pw) > maxPasswordBytes {
		return fmt.Sprintf("Password must not exceed %d bytes", maxPasswordBytes)
	}
	return ""
}

// loadOrCreateJWTKey reads the 32-byte signing key from keyDir/jwt.key. keyDir is
// the project base dir (next to the executable), NOT the browsable workspace root
// (dataDir) — the signing key must never be listable/downloadable via the file
// manager. Legacy installs kept it at dataDir/jwt.key; if present there and not yet
// at the new location, it is migrated (key preserved, so sessions stay valid) and
// the old file removed so it disappears from the workspace. On first run a random
// key is generated and persisted.
func loadOrCreateJWTKey(keyDir, dataDir string) ([]byte, error) {
	path := filepath.Join(keyDir, jwtKeyFilename)
	// one-time migration out of the old in-workspace location.
	if legacy := filepath.Join(dataDir, jwtKeyFilename); legacy != path {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if data, rerr := os.ReadFile(legacy); rerr == nil {
				if werr := os.WriteFile(path, data, 0o600); werr == nil {
					_ = os.Remove(legacy)
					log.Printf("[auth] JWT key migrated from %s to %s (outside the browsable workspace)", legacy, path)
				}
			}
		}
	}
	if data, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(data))) >= 32 {
		return []byte(strings.TrimSpace(string(data))), nil
	}
	buf := make([]byte, 32)
	for i := range buf {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(keyChars))))
		if err != nil {
			return nil, fmt.Errorf("generate jwt key: %w", err)
		}
		buf[i] = keyChars[n.Int64()]
	}
	if err := os.WriteFile(path, buf, 0600); err != nil {
		return nil, fmt.Errorf("write jwt key: %w", err)
	}
	log.Printf("[auth] New JWT key written to %s", path)
	return buf, nil
}

// authClaims 在标准 claims 之外记录会话起始时间，供 /api/auth/refresh 判断绝对
// 会话上限。token 版本不放在 claims 里：它被折进签名密钥（deriveJWTKey），因此
// 版本升级与验签失败是同一件事，服务端无需信任 token 里的版本字段。
type authClaims struct {
	SessionStart int64 `json:"sst,omitempty"`
	jwt.RegisteredClaims
}

// deriveJWTKey binds the signing key to the persisted token version. Version 0
// returns the on-disk key unchanged, so tokens minted by a pre-patch build stay
// valid across the upgrade (no forced logout); every later bump makes them fail
// HMAC verification at once, without a per-request denylist or store lookup.
func deriveJWTKey(base []byte, ver int64) []byte {
	if ver == 0 {
		return base
	}
	mac := hmac.New(sha256.New, base)
	fmt.Fprintf(mac, "artex-jwt-token-version:%d", ver)
	return mac.Sum(nil)
}

// signingKey returns the current HS256 key (on-disk key derived with the token
// version). Reads take the same lock as password-change bumps.
func (s *Server) signingKey() []byte {
	s.authMu.RLock()
	defer s.authMu.RUnlock()
	return s.jwtKey
}

// loadTokenVersion restores the persisted token epoch and derives the signing
// key from it. An unreadable/unparsable epoch becomes -1, which matches no
// persisted version: previously issued tokens are refused (fail closed) rather
// than resurrecting tokens a password change may have revoked.
func (s *Server) loadTokenVersion() {
	if s.m == nil || s.m.pg == nil {
		return
	}
	ver := int64(0)
	raw, ok, err := s.m.pg.GetSetting(authTokenVersionKey)
	switch {
	case err != nil:
		log.Printf("[auth] token version unreadable (%v) — invalidating previously issued tokens", err)
		ver = -1
	case ok && strings.TrimSpace(raw) != "":
		parsed, perr := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if perr != nil {
			log.Printf("[auth] token version %q unparsable (%v) — invalidating previously issued tokens", raw, perr)
			ver = -1
		} else {
			ver = parsed
		}
	}
	s.authMu.Lock()
	s.tokenVer = ver
	s.jwtKey = deriveJWTKey(s.jwtBase, ver)
	s.authMu.Unlock()
}

// bumpTokenVersion persists ver+1 and swaps the in-memory signing key. Every
// token issued before the call (including a stolen 7-day one) fails signature
// verification from that moment on. Called on password change.
func (s *Server) bumpTokenVersion() error {
	if s.m == nil || s.m.pg == nil {
		return fmt.Errorf("database unavailable")
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	base := s.tokenVer
	if base < 0 {
		// Startup could not read the epoch. Re-read it now rather than writing a
		// lower value, which could resurrect a previously retired signing key.
		raw, ok, err := s.m.pg.GetSetting(authTokenVersionKey)
		if err != nil {
			return fmt.Errorf("read token version: %w", err)
		}
		base = 0
		if ok && strings.TrimSpace(raw) != "" {
			parsed, perr := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
			if perr != nil {
				return fmt.Errorf("parse token version %q: %w", raw, perr)
			}
			base = parsed
		}
	}
	next := base + 1
	if next <= 0 {
		next = 1
	}
	if err := s.m.pg.SetSetting(authTokenVersionKey, strconv.FormatInt(next, 10)); err != nil {
		return err
	}
	s.tokenVer = next
	s.jwtKey = deriveJWTKey(s.jwtBase, next)
	return nil
}

// signJWT issues a 1-hour HS256 token that starts a new session. The signature
// is unchanged so existing call sites (notably test helpers) keep working;
// handlers that must preserve an existing session use signJWTSession.
func signJWT(key []byte) (string, error) {
	return signJWTSession(key, time.Now())
}

// signJWTSession issues a 1-hour token bound to sessionStart, which is carried
// in the sst claim so /api/auth/refresh cannot extend a session past
// jwtSessionTTL.
func signJWTSession(key []byte, sessionStart time.Time) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, authClaims{
		SessionStart: sessionStart.Unix(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "ARTEX",
			ExpiresAt: jwt.NewNumericDate(now.Add(jwtTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}).SignedString(key)
}

// parseJWT validates algorithm (HS256 only), signature, subject, and expiry,
// returning the claims so callers can enforce the session window.
func parseJWT(tokenStr string, key []byte) (*authClaims, bool) {
	if tokenStr == "" {
		return nil, false
	}
	claims := &authClaims{}
	t, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		return key, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil || !t.Valid || claims.Subject != "ARTEX" {
		return nil, false
	}
	return claims, true
}

// verifyJWT returns true when tokenStr is a valid, non-expired HS256 token for
// this install's current signing key (which already encodes the token version).
func verifyJWT(tokenStr string, key []byte) bool {
	_, ok := parseJWT(tokenStr, key)
	return ok
}

// extractToken reads the JWT from Authorization: Bearer header or the
// artex_token cookie. Query-string tokens are deliberately NOT read here:
// URLs land in browser history, proxy logs and Referer headers, so a bearer
// credential there leaks by design. The SSE endpoints below are the only
// exception (EventSource cannot set an Authorization header).
func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if c, err := r.Cookie("artex_token"); err == nil && c.Value != "" {
		return c.Value
	}
	return ""
}

// queryTokenPathAllowed reports whether ?token= may be used for this request.
// Only the browser SSE endpoints — exact paths, GET/HEAD only — may carry the
// token in the query, which keeps the cross-origin dev setup working (the
// cookie is not sent on a no-cors EventSource) while every JSON API requires
// the header or cookie.
func queryTokenPathAllowed(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	switch r.URL.Path {
	case "/api/logs/stream", "/api/exploration/activity/stream":
		return true
	}
	if id, ok := strings.CutPrefix(r.URL.Path, "/api/side-questions/"); ok {
		return strings.HasSuffix(id, "/events") && !strings.Contains(strings.TrimSuffix(id, "/events"), "/")
	}
	return false
}

// requireAuth wraps h with JWT validation.
// /api/auth/* and /api/health are exempt.
func (s *Server) requireAuth(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/auth/") || p == "/api/health" {
			h.ServeHTTP(w, r)
			return
		}
		tok := extractToken(r)
		if tok == "" && queryTokenPathAllowed(r) {
			tok = r.URL.Query().Get("token")
		}
		if tok == "" {
			writeErr(w, 401, "Unauthorized")
			return
		}
		if !verifyJWT(tok, s.signingKey()) {
			writeErr(w, 401, "Invalid or expired token")
			return
		}
		h.ServeHTTP(w, r)
	})
}

// GET /api/auth/status — reports whether the admin password has been initialised.
// 读失败必须回 503 而不是 initialized:false：前端在 initialized:false 时会把用户
// 送到 /setup 去设置密码（login/page.tsx），把数据库故障包装成 200 等于把用户往
// 覆盖已有密码的路上推。
func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	hash, _, err := pg.GetSetting(authPassKey)
	if err != nil {
		writeErr(w, 503, errDataSourceUnavailable)
		return
	}
	writeJSON(w, 200, map[string]any{"initialized": hash != "", "setup_required": hash == ""})
}

// POST /api/auth/init — sets the password for the first time; rejected if already set.
func (s *Server) authInit(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	existing, _, err := pg.GetSetting(authPassKey)
	if err != nil {
		writeErr(w, 503, errDataSourceUnavailable)
		return
	}
	if existing != "" {
		writeErr(w, 403, "Password has already been set")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := decodeJSONBounded(w, r, &req, maxAuthJSONBodyBytes); err != nil {
		if !writeJSONBodyTooLarge(w, err) {
			writeErr(w, 400, "Password is required")
		}
		return
	}
	if req.Password == "" {
		writeErr(w, 400, "Password is required")
		return
	}
	if msg := validatePassword(req.Password); msg != "" {
		writeErr(w, 400, msg)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, "Failed to hash password")
		return
	}
	// 用 INSERT ... ON CONFLICT DO NOTHING 而不是 upsert：上面那次 GetSetting 只是
	// 快速失败路径，真正"仅首次可设"的保证落在主键约束上。bcrypt 要跑几十毫秒，
	// 这期间别的请求完全可能先把密码设好，而读检查本身也可能因故障而失效。
	inserted, err := pg.InsertSettingIfAbsent(authPassKey, string(hash))
	if err != nil {
		writeErr(w, 500, "Failed to save: "+err.Error())
		return
	}
	if !inserted {
		writeErr(w, 403, "Password has already been set")
		return
	}
	tok, err := signJWT(s.signingKey())
	if err != nil {
		writeErr(w, 500, "Failed to generate token")
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok})
}

// POST /api/auth/change-password — changes the admin password. Requires a valid
// token (this route is under /api/auth/* which requireAuth exempts, so the token
// is validated here) AND the current password.
//
// On success the token epoch is bumped, so every token issued before this call —
// on this device or any other, and any stolen copy — is rejected. A fresh token
// for the current session is returned so the caller stays signed in.
func (s *Server) authChangePassword(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	claims, ok := parseJWT(extractToken(r), s.signingKey())
	if !ok {
		writeErr(w, 401, "Unauthorized")
		return
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := decodeJSONBounded(w, r, &req, maxAuthJSONBodyBytes); err != nil {
		if !writeJSONBodyTooLarge(w, err) {
			writeErr(w, 400, "Invalid request format")
		}
		return
	}
	if req.NewPassword == "" {
		writeErr(w, 400, "New password is required")
		return
	}
	if msg := validatePassword(req.NewPassword); msg != "" {
		writeErr(w, 400, msg)
		return
	}
	hash, ok, err := pg.GetSetting(authPassKey)
	if err != nil {
		writeErr(w, 503, errDataSourceUnavailable)
		return
	}
	if !ok || hash == "" {
		writeErr(w, 403, "Password has not been initialized. Set a password first")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.OldPassword)); err != nil {
		writeErr(w, 401, "Current password is incorrect")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, "Failed to hash password")
		return
	}
	// Revoke first, persist second. If the epoch bump fails we abort untouched;
	// if the epoch bump succeeds but the hash write fails, every session is
	// logged out while the old password stays valid — the fail-safe direction.
	if err := s.bumpTokenVersion(); err != nil {
		log.Printf("[auth] token version bump failed, password NOT changed: %v", err)
		writeErr(w, 500, "Failed to revoke existing sessions: "+err.Error())
		return
	}
	if err := pg.SetSetting(authPassKey, string(newHash)); err != nil {
		writeErr(w, 500, "Failed to save: "+err.Error())
		return
	}
	// Keep this device signed in: same session start (so the absolute cap still
	// applies), new signing key.
	sessionStart := time.Now()
	if claims.SessionStart > 0 {
		sessionStart = time.Unix(claims.SessionStart, 0)
	}
	tok, err := signJWTSession(s.signingKey(), sessionStart)
	if err != nil {
		writeErr(w, 500, "Password changed, but failed to generate token")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "token": tok, "expires_in": int(jwtTTL.Seconds())})
}

// POST /api/auth/refresh — rotates a still-valid token into a fresh 1-hour one.
// The session start (sst) is preserved, so refreshing cannot outlive
// jwtSessionTTL; a password change makes every old token fail signature
// verification before it ever reaches this handler.
func (s *Server) authRefresh(w http.ResponseWriter, r *http.Request) {
	claims, ok := parseJWT(extractToken(r), s.signingKey())
	if !ok {
		writeErr(w, 401, "Unauthorized")
		return
	}
	started := int64(0)
	if claims.SessionStart > 0 {
		started = claims.SessionStart
	} else if claims.IssuedAt != nil {
		// Tokens minted before the sst claim existed: treat issuance as the start.
		started = claims.IssuedAt.Unix()
	}
	if started <= 0 || time.Since(time.Unix(started, 0)) >= jwtSessionTTL {
		writeErr(w, 401, "Session expired, please sign in again")
		return
	}
	tok, err := signJWTSession(s.signingKey(), time.Unix(started, 0))
	if err != nil {
		writeErr(w, 500, "Failed to generate token")
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok, "expires_in": int(jwtTTL.Seconds())})
}

// POST /api/auth/login — validates username/password and returns a JWT.
func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSONBounded(w, r, &req, maxAuthJSONBodyBytes); err != nil {
		if !writeJSONBodyTooLarge(w, err) {
			writeErr(w, 400, "Invalid request format")
		}
		return
	}
	if req.Username != "ARTEX" {
		writeErr(w, 401, "Incorrect username or password")
		return
	}
	hash, ok, err := pg.GetSetting(authPassKey)
	if err != nil {
		writeErr(w, 503, errDataSourceUnavailable)
		return
	}
	if !ok || hash == "" {
		writeErr(w, 403, "Password has not been initialized. Set a password first")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		writeErr(w, 401, "Incorrect username or password")
		return
	}
	tok, err := signJWT(s.signingKey())
	if err != nil {
		writeErr(w, 500, "Failed to generate token")
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok})
}
