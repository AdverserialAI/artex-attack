package agent

import (
	"os"
	"path/filepath"
	"testing"

	"norma/llm"
)

func TestConfigFromBootstrapReadsPrivateKeyFile(t *testing.T) {
	root := t.TempDir()
	old := runtimeSecretRoot
	runtimeSecretRoot = root
	t.Cleanup(func() { runtimeSecretRoot = old })
	key := filepath.Join(root, "cyberseek-api-key")
	if err := os.WriteFile(key, []byte("sk-abcdefghijklmnopqrstuvwxyz1234567890"), 0o600); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(root, "artex-llm.json")
	document := `{"provider":"openai","model":"adverserial/cyberseek","base_url":"https://api.adverserial.ai/v1","api_key_file":"` + key + `"}`
	if err := os.WriteFile(config, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := configFromBootstrap(config)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Format != llm.FormatOpenAI || cfg.Model != "adverserial/cyberseek" || cfg.APIKey == "" {
		t.Fatalf("unexpected bootstrap config: %#v", cfg)
	}
}

func TestConfigFromBootstrapRejectsEscapesBroadModesAndHTTP(t *testing.T) {
	root := t.TempDir()
	old := runtimeSecretRoot
	runtimeSecretRoot = root
	t.Cleanup(func() { runtimeSecretRoot = old })
	outside := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(outside, []byte("sk-abcdefghijklmnopqrstuvwxyz1234567890"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, document := range map[string]string{
		"escape":   `{"provider":"openai","api_key_file":"` + outside + `"}`,
		"http":     `{"provider":"openai","base_url":"http://example.test/v1","api_key_file":"` + outside + `"}`,
		"query":    `{"provider":"openai","base_url":"https://example.test/v1?token=leak","api_key_file":"` + outside + `"}`,
		"fragment": `{"provider":"openai","base_url":"https://example.test/v1#fragment","api_key_file":"` + outside + `"}`,
		"unknown":  `{"provider":"openai","api_key_file":"` + outside + `","secret":"value"}`,
	} {
		config := filepath.Join(root, name+".json")
		if err := os.WriteFile(config, []byte(document), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := configFromBootstrap(config); err == nil {
			t.Fatalf("%s bootstrap should be rejected", name)
		}
	}
	tooBroad := filepath.Join(root, "broad-key")
	if err := os.WriteFile(tooBroad, []byte("sk-abcdefghijklmnopqrstuvwxyz1234567890"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readRuntimeSecret(tooBroad, 4096); err == nil {
		t.Fatal("group/world-readable key must be rejected")
	}
}

func TestInvalidBootstrapDoesNotFallBackToEnvironmentKey(t *testing.T) {
	t.Setenv("ARTEX_LLM_BOOTSTRAP_FILE", "/run/adverserial/current/missing")
	t.Setenv("OPENAI_API_KEY", "sk-abcdefghijklmnopqrstuvwxyz1234567890")
	t.Setenv("ARTEX_LLM_PROVIDER", "openai")
	if _, ok := FromEnv(); ok {
		t.Fatal("invalid measured-runtime bootstrap must fail closed")
	}
}
