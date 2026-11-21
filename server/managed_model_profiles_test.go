package server

import (
	"encoding/json"
	"strings"
	"testing"

	"artex/agent"
	"norma/llm"
)

func managedAnswer(t *testing.T, configs []agent.Config, ok bool) (map[string]any, string) {
	t.Helper()
	old := managedRuntimeConfigs
	managedRuntimeConfigs = func() ([]agent.Config, bool) { return configs, ok }
	t.Cleanup(func() { managedRuntimeConfigs = old })
	out, managed := managedRuntimeModels()
	if !managed {
		t.Fatal("a deployment with a runtime bootstrap must answer as managed")
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	return out, string(raw)
}

func TestProfilesAreListedNormallyOutsideTheManagedRuntime(t *testing.T) {
	t.Setenv("ARTEX_LLM_BOOTSTRAP_FILE", "")
	if _, managed := managedRuntimeModels(); managed {
		t.Fatal("without a runtime bootstrap the stored profiles must be listed as before")
	}
}

// Whatever the owner connected, the answer names the model every task runs on and
// tells the orchestration agent that no profile is needed. It never carries a key
// or an endpoint.
func TestManagedRuntimeNamesTheConnectedModelForEveryWayOfConnectingOne(t *testing.T) {
	t.Setenv("ARTEX_LLM_BOOTSTRAP_FILE", "/run/adverserial/current/llm/bootstrap.json")
	const secret = "sk-must-never-appear-0000000000000000"
	cases := map[string][]agent.Config{
		"CyberSEEK through the in-VM proxy": {{Format: llm.Format("openai"), Model: "adverserial/cyberseek", BaseURL: "http://model-proxy:8089/v1", APIKey: secret}},
		"own Anthropic key":                 {{Format: llm.Format("anthropic"), Model: "claude-opus-5-5", APIKey: secret}},
		"own OpenAI key":                    {{Format: llm.Format("openai"), Model: "gpt-5", APIKey: secret}},
		"own key with a custom endpoint":    {{Format: llm.Format("openai"), Model: "my-model", BaseURL: "https://llm.customer.example/v1", APIKey: secret}},
		"both own keys, Anthropic first": {
			{Format: llm.Format("anthropic"), Model: "claude-opus-5-5", APIKey: secret},
			{Format: llm.Format("openai"), Model: "gpt-5", APIKey: secret},
		},
	}
	for name, configs := range cases {
		t.Run(name, func(t *testing.T) {
			out, raw := managedAnswer(t, configs, true)
			if out["engine_ready"] != true || out["managed"] != true {
				t.Fatalf("a connected model must be reported as ready: %s", raw)
			}
			models := out["models"].([]map[string]any)
			if len(models) != len(configs) || models[0]["model"] != configs[0].Model || models[0]["role"] != "active" {
				t.Fatalf("the connected model must be named first and active: %s", raw)
			}
			if len(models) == 2 && models[1]["role"] != "fallback" {
				t.Fatalf("the second provider is the fallback: %s", raw)
			}
			if !strings.Contains(raw, "Do not pass llm_profile_id") || !strings.Contains(raw, "spawn_task") {
				t.Fatalf("the answer must tell the agent that spawned tasks need no profile: %s", raw)
			}
			for _, leak := range []string{secret, "model-proxy", "customer.example", "api_key", "base_url"} {
				if strings.Contains(raw, leak) {
					t.Fatalf("the answer must not carry %q: %s", leak, raw)
				}
			}
			if profiles, _ := out["profiles"].([]any); len(profiles) != 0 {
				t.Fatalf("no stored profile is offered in the managed runtime: %s", raw)
			}
		})
	}
}

// No model connected yet, or a bootstrap that was rejected: say that plainly, and
// who can fix it, instead of an empty list.
func TestManagedRuntimeSaysWhenNoModelIsConnected(t *testing.T) {
	t.Setenv("ARTEX_LLM_BOOTSTRAP_FILE", "/run/adverserial/current/llm/bootstrap.json")
	for name, ok := range map[string]bool{"owner has not connected one": true, "bootstrap rejected": false} {
		t.Run(name, func(t *testing.T) {
			out, raw := managedAnswer(t, nil, ok)
			if out["engine_ready"] != false || !strings.Contains(raw, "Connect model") || strings.Contains(raw, "\"models\"") {
				t.Fatalf("an idle engine must be reported as not ready, with the way to fix it: %s", raw)
			}
		})
	}
}
