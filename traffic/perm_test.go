//go:build !windows

package traffic

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// TestOpenRestrictsStorePermissions pins the owner-only modes: the store root,
// index, blob and CA directories are 0700, and both SQLite's index and the CA
// private key are 0600. Without this, a regression back to 0755/0644 would only
// be visible to a reviewer re-reading every creation site.
func TestOpenRestrictsStorePermissions(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "traffic")
	tr, err := Open(dir, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tr.Close()

	for _, d := range []string{dir, filepath.Join(dir, "_index"), filepath.Join(dir, "_blobs"), filepath.Join(dir, "_ca")} {
		assertPerm(t, d, 0o700)
	}
	assertPerm(t, filepath.Join(dir, "_index", "index.sqlite"), 0o600)
	assertPerm(t, filepath.Join(dir, "_ca", "mitmproxy-ca.pem"), 0o600)
}

// TestSpillRestrictsBlobPermissions covers the body spill path: bodies above
// maxInlineBody land in _blobs and must be 0600, since they are the verbatim
// target traffic (tokens, cookies, PII) that finding 62 is about.
func TestSpillRestrictsBlobPermissions(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "traffic")
	tr, err := Open(dir, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tr.Close()

	sb := tr.spill(bytes.Repeat([]byte("a"), maxInlineBody+1), "text/plain")
	if sb.hash == "" {
		t.Fatal("spill did not write a blob for an oversized body")
	}
	assertPerm(t, filepath.Join(dir, "_blobs", "sha256", sb.hash[:2], sb.hash+".bin"), 0o600)
}

func assertPerm(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	st, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := st.Mode().Perm(); got != want {
		t.Errorf("%s mode = %#o, want %#o", path, got, want)
	}
}
