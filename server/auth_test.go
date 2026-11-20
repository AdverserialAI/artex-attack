package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// GetSetting 对"键不存在"和"读取出错"的返回值只差一个 error：两种情况 value 都是
// 空串。密码相关的 handler 一旦把 error 当成"还没设置密码"，就会在数据库抖动期间
// 敞开初始化入口——authInit 会放行一个未认证请求去覆盖已有的管理员密码，
// authStatus 则会把前端直接送到 /setup 去照着做这件事。
//
// 这两个测试把 handler 的连接池关掉来制造读取失败，断言两处都 fail closed。
func TestAuthStatusFailsClosedWhenDataSourceUnavailable(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	// 关掉池子，让后续 GetSetting 返回 error 而不是 sql.ErrNoRows。
	if err := m.pg.Close(); err != nil {
		t.Fatal(err)
	}

	s := &Server{m: m}
	w := httptest.NewRecorder()
	s.authStatus(w, httptest.NewRequest("GET", "/api/auth/status", nil))

	if w.Code != 503 {
		t.Fatalf("status=%d want 503 (读失败被当成未初始化会把用户送去 /setup 覆盖密码); body=%s", w.Code, w.Body.String())
	}
	var payload struct {
		Initialized *bool `json:"initialized"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err == nil && payload.Initialized != nil {
		t.Fatalf("读失败时不应回答 initialized，得到 %v", *payload.Initialized)
	}
}

func TestAuthInitFailsClosedWhenDataSourceUnavailable(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	if err := m.pg.Close(); err != nil {
		t.Fatal(err)
	}

	s := &Server{m: m}
	w := httptest.NewRecorder()
	body := strings.NewReader(`{"password":"correct horse battery"}`)
	s.authInit(w, httptest.NewRequest("POST", "/api/auth/init", body))

	if w.Code != 503 {
		t.Fatalf("status=%d want 503 (读失败时放行会让未认证请求覆盖已有密码); body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "token") {
		t.Fatalf("读失败时不应签发 token: %s", w.Body.String())
	}
}

// 首次初始化只需提交密码；密码设置成功后 init 入口关闭。
// 用与既有测试同款方式起 Manager（postgres 不可用时 skip）。
func TestAuthInitOnlyOnce(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	pg := m.pg
	_, _ = pg.Exec(`DELETE FROM settings WHERE key = $1`, authPassKey)
	defer func() { _, _ = pg.Exec(`DELETE FROM settings WHERE key = $1`, authPassKey) }()

	s := &Server{m: m}
	for _, tc := range []struct {
		name string
		body string
		want int
	}{
		{"首次设置密码", `{"password":"correct horse battery"}`, 200},
		{"已初始化后再试", `{"password":"another pass"}`, 403},
	} {
		w := httptest.NewRecorder()
		s.authInit(w, httptest.NewRequest("POST", "/api/auth/init", strings.NewReader(tc.body)))
		if w.Code != tc.want {
			t.Fatalf("%s: status=%d want %d; body=%s", tc.name, w.Code, tc.want, w.Body.String())
		}
	}
}

// The public auth endpoints (/api/auth/login, /api/auth/init) and the JWT-guarded
// change-password must cap their JSON body before decoding. A chunked body larger
// than the cap is 413 and is not read past the cap + 1 detection byte, so a huge
// password cannot be buffered just to be rejected by validatePassword afterwards.
func TestAuthEndpointsRejectOversizedBody(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	s := &Server{m: m}

	newBody := func() *countingReader {
		return &countingReader{data: []byte(`{"username":"ARTEX","old_password":"` + strings.Repeat("a", maxAuthJSONBodyBytes) + `","new_password":"` + strings.Repeat("b", maxAuthJSONBodyBytes) + `"}`)}
	}
	check := func(t *testing.T, rec *httptest.ResponseRecorder, reader *countingReader) {
		t.Helper()
		if rec.Code != 413 {
			t.Fatalf("status=%d want 413; body=%q", rec.Code, rec.Body.String())
		}
		if reader.read > maxAuthJSONBodyBytes+1 {
			t.Fatalf("handler read %d bytes for a %d byte cap", reader.read, maxAuthJSONBodyBytes)
		}
		if msg := assertSingleErrorResponse(t, rec); !strings.Contains(msg, "Request body is too large") {
			t.Fatalf("error=%q", msg)
		}
	}

	t.Run("login", func(t *testing.T) {
		reader := newBody()
		req := httptest.NewRequest("POST", "/api/auth/login", reader)
		rec := httptest.NewRecorder()
		s.authLogin(rec, req)
		check(t, rec, reader)
	})

	t.Run("init", func(t *testing.T) {
		pg := m.pg
		prevHash, hadPrev, _ := pg.GetSetting(authPassKey)
		_, _ = pg.Exec(`DELETE FROM settings WHERE key = $1`, authPassKey)
		defer func() {
			if hadPrev {
				_ = pg.SetSetting(authPassKey, prevHash)
			}
		}()
		reader := newBody()
		req := httptest.NewRequest("POST", "/api/auth/init", reader)
		rec := httptest.NewRecorder()
		s.authInit(rec, req)
		check(t, rec, reader)
		if hash, _, err := pg.GetSetting(authPassKey); err != nil || hash != "" {
			t.Fatalf("oversized init must not set a password: hash=%q err=%v", hash, err)
		}
	})

	t.Run("change-password", func(t *testing.T) {
		tok, err := signJWT(s.jwtKey)
		if err != nil {
			t.Fatalf("sign token: %v", err)
		}
		reader := newBody()
		req := httptest.NewRequest("POST", "/api/auth/change-password", reader)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		s.authChangePassword(rec, req)
		check(t, rec, reader)
	})
}

func TestValidatePassword(t *testing.T) {
	for _, tc := range []struct {
		name, pw string
		wantErr  bool
	}{
		{"空", "", true},
		{"七位", "1234567", true},
		{"八位", "12345678", false},
		{"八个汉字按字符数而非字节数计", "密码密码密码密码", false},
		{"三个汉字够 9 字节但只有 3 个字符", "密码强", true},
		{"72 字节", strings.Repeat("a", 72), false},
		{"73 字节超出 bcrypt 上限", strings.Repeat("a", 73), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validatePassword(tc.pw); (got != "") != tc.wantErr {
				t.Fatalf("validatePassword(%q)=%q, wantErr=%v", tc.pw, got, tc.wantErr)
			}
		})
	}
}

// finding-64: the JWT must not be accepted from ?token= except on the browser
// SSE endpoints, where EventSource cannot set an Authorization header. Every
// JSON API must require the header (or cookie), because URLs leak into browser
// history, proxy logs and Referer headers.
func TestQueryTokenOnlyOnStreamPaths(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	s := &Server{jwtKey: key}
	tok, err := signJWT(s.signingKey())
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	h := s.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	do := func(method, target string, bearer bool) int {
		req := httptest.NewRequest(method, target, nil)
		if bearer {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	for _, tc := range []struct {
		name   string
		method string
		target string
		bearer bool
		want   int
	}{
		{"header still works on JSON API", "GET", "/api/tasks", true, 204},
		{"query token rejected on JSON API", "GET", "/api/tasks?token=" + tok, false, 401},
		{"query token rejected on file download", "GET", "/api/workspace/download?token=" + tok, false, 401},
		{"query token allowed on logs stream", "GET", "/api/logs/stream?since=0&token=" + tok, false, 204},
		{"query token rejected on disabled update stream", "GET", "/api/update/stream?token=" + tok, false, 401},
		{"query token allowed on activity stream", "GET", "/api/exploration/activity/stream?task=1&since=0&token=" + tok, false, 204},
		{"query token allowed on side-question events", "GET", "/api/side-questions/7/events?token=" + tok, false, 204},
		{"query token rejected on non-events side route", "GET", "/api/side-questions/7/other?token=" + tok, false, 401},
		{"query token rejected on nested side path", "GET", "/api/side-questions/7/a/events?token=" + tok, false, 401},
		{"query token rejected on non-GET", "POST", "/api/logs/stream?token=" + tok, false, 401},
		{"tampered query token rejected", "GET", "/api/logs/stream?token=" + tok + "x", false, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := do(tc.method, tc.target, tc.bearer); got != tc.want {
				t.Fatalf("%s %s bearer=%v → %d, want %d", tc.method, tc.target, tc.bearer, got, tc.want)
			}
		})
	}
}

// finding-64: /api/auth/refresh may rotate the 1-hour access token but must not
// extend a session beyond the absolute cap, and it must not accept ?token=.
func TestAuthRefreshEnforcesSessionCap(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	s := &Server{jwtKey: key}
	fresh, err := signJWTSession(key, time.Now())
	if err != nil {
		t.Fatalf("sign fresh: %v", err)
	}
	stale, err := signJWTSession(key, time.Now().Add(-jwtSessionTTL-time.Minute))
	if err != nil {
		t.Fatalf("sign stale: %v", err)
	}
	for _, tc := range []struct {
		name string
		tok  string
		want int
	}{
		{"fresh session rotates", fresh, 200},
		{"session past absolute cap", stale, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/auth/refresh", nil)
			req.Header.Set("Authorization", "Bearer "+tc.tok)
			rec := httptest.NewRecorder()
			s.authRefresh(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d want %d; body=%s", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want != 200 {
				return
			}
			var out struct {
				Token string `json:"token"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.Token == "" {
				t.Fatalf("refresh must return a token: err=%v body=%s", err, rec.Body.String())
			}
			if !verifyJWT(out.Token, key) {
				t.Fatal("refreshed token does not verify")
			}
		})
	}
	// EventSource is not used for refresh: the query form must be rejected even
	// though the endpoint is under /api/auth/ (it validates the token itself).
	req := httptest.NewRequest("POST", "/api/auth/refresh?token="+fresh, nil)
	rec := httptest.NewRecorder()
	s.authRefresh(rec, req)
	if rec.Code != 401 {
		t.Fatalf("refresh via ?token= → %d, want 401", rec.Code)
	}
}

// finding-64: changing the password must revoke every previously issued token
// (the token epoch is bumped, the signing key is re-derived) and hand the
// calling session a new token.
func TestPasswordChangeRevokesOldTokens(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v)", err)
	}
	defer m.Close()
	pg := m.pg
	prevHash, hadHash, _ := pg.GetSetting(authPassKey)
	prevVer, hadVer, _ := pg.GetSetting(authTokenVersionKey)
	t.Cleanup(func() {
		if hadHash {
			_ = pg.SetSetting(authPassKey, prevHash)
		} else {
			_, _ = pg.Exec(`DELETE FROM settings WHERE key=$1`, authPassKey)
		}
		if hadVer {
			_ = pg.SetSetting(authTokenVersionKey, prevVer)
		} else {
			_, _ = pg.Exec(`DELETE FROM settings WHERE key=$1`, authTokenVersionKey)
		}
	})

	const oldPassword = "old password 123"
	oldHash, err := bcrypt.GenerateFromPassword([]byte(oldPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := pg.SetSetting(authPassKey, string(oldHash)); err != nil {
		t.Fatalf("seed password: %v", err)
	}
	if _, err := pg.Exec(`DELETE FROM settings WHERE key=$1`, authTokenVersionKey); err != nil {
		t.Fatalf("reset token version: %v", err)
	}

	s := &Server{m: m, jwtBase: []byte("unit-test-key-0123456789abcdef0123456789abcdef")}
	s.jwtKey = s.jwtBase
	oldTok, err := signJWT(s.signingKey())
	if err != nil {
		t.Fatalf("sign old token: %v", err)
	}
	body := strings.NewReader(`{"old_password":"` + oldPassword + `","new_password":"new password 456"}`)
	req := httptest.NewRequest("POST", "/api/auth/change-password", body)
	req.Header.Set("Authorization", "Bearer "+oldTok)
	rec := httptest.NewRecorder()
	s.authChangePassword(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status=%d want 200; body=%s", rec.Code, rec.Body.String())
	}
	if verifyJWT(oldTok, s.signingKey()) {
		t.Fatal("old token still verifies after the password change")
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.Token == "" {
		t.Fatalf("change-password must return a fresh token: err=%v body=%s", err, rec.Body.String())
	}
	if !verifyJWT(out.Token, s.signingKey()) {
		t.Fatal("fresh token does not verify after the password change")
	}
	ver, ok, err := pg.GetSetting(authTokenVersionKey)
	if err != nil || !ok || strings.TrimSpace(ver) == "" {
		t.Fatalf("token version not persisted: value=%q ok=%v err=%v", ver, ok, err)
	}
}

// finding-64: keep the access-token window short and the absolute session cap
// finite; a regression to a multi-day TTL must be caught in review/CI.
func TestJWTWindowsAreShort(t *testing.T) {
	if jwtTTL > 2*time.Hour {
		t.Fatalf("jwtTTL=%v: access tokens must stay short (refresh rotates them)", jwtTTL)
	}
	if jwtSessionTTL <= jwtTTL {
		t.Fatalf("jwtSessionTTL=%v must exceed jwtTTL=%v", jwtSessionTTL, jwtTTL)
	}
}
