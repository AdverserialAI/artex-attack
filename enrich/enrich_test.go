package enrich

import (
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildClientVerifiesTLSAndTrustsConfiguredCA(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer server.Close()

	certificate := server.Certificate().Raw
	caPath := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate}), 0o600); err != nil {
		t.Fatal(err)
	}

	direct := buildClient(func() string { return "" }, func() string { return "" })
	response, err := direct.Get(server.URL)
	if err == nil {
		response.Body.Close()
		t.Fatal("self-signed certificate was accepted without a configured CA")
	}

	trusted := buildClient(func() string { return "" }, func() string { return caPath })
	response, err = trusted.Get(server.URL)
	if err != nil {
		t.Fatalf("certificate signed by the configured CA was rejected: %v", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
}
