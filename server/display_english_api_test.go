package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEnglishDisplayAPI(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("database unavailable (%v) — skipping English display API test", err)
	}
	defer m.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	td := t.TempDir()
	s := New(ctx, m, td, td, td)
	handler := s.Handler()
	token, err := signJWT(s.jwtKey)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	get := func(path string, target any) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s: status %d: %s", path, recorder.Code, recorder.Body.String())
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
			t.Fatalf("GET %s: decode response: %v", path, err)
		}
	}

	var agents struct {
		Agents []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Builtin     bool   `json:"builtin"`
		} `json:"agents"`
	}
	get("/api/agents", &agents)
	for _, agent := range agents.Agents {
		if agent.Builtin {
			requireNoHan(t, agent.Name)
			requireNoHan(t, agent.Description)
		}
	}

	var agentDetail struct {
		Variables []struct {
			Description string `json:"description"`
			Example     string `json:"example"`
		} `json:"variables"`
	}
	get("/api/agents/planner", &agentDetail)
	for _, variable := range agentDetail.Variables {
		requireNoHan(t, variable.Description)
		requireNoHan(t, variable.Example)
	}

	var tools struct {
		Tools []struct {
			Key         string `json:"key"`
			System      bool   `json:"system"`
			Description string `json:"description"`
		} `json:"tools"`
	}
	get("/api/tools", &tools)
	for _, tool := range tools.Tools {
		if tool.System {
			if strings.TrimSpace(tool.Description) == "" {
				t.Errorf("tool %s has an empty description", tool.Key)
			}
			requireNoHan(t, tool.Description)
		}
	}

	var categories struct {
		Categories []struct {
			Name string `json:"name"`
		} `json:"categories"`
	}
	get("/api/task-categories", &categories)
	for _, category := range categories.Categories {
		if _, legacy := scenarioDisplayNames[category.Name]; legacy {
			t.Errorf("category still has its legacy name: %q", category.Name)
		}
	}

	for _, path := range []string{"/api/planner-templates", "/api/worker-templates"} {
		var templates struct {
			Templates []struct {
				Name    string `json:"name"`
				Builtin bool   `json:"builtin"`
			} `json:"templates"`
		}
		get(path, &templates)
		for _, template := range templates.Templates {
			if template.Builtin {
				requireNoHan(t, template.Name)
			}
		}
	}

	var interceptRules struct {
		Rules []struct {
			Name    string `json:"name"`
			Message string `json:"message"`
		} `json:"rules"`
	}
	get("/api/intercept/rules", &interceptRules)
	for _, rule := range interceptRules.Rules {
		if strings.HasPrefix(rule.Name, "[Built-in]") {
			requireNoHan(t, rule.Name)
			requireNoHan(t, rule.Message)
		}
	}

	var assetRules struct {
		Rules []struct {
			Note    string `json:"note"`
			Builtin bool   `json:"builtin"`
		} `json:"rules"`
	}
	get("/api/asset-intercept/rules", &assetRules)
	for _, rule := range assetRules.Rules {
		if rule.Builtin {
			requireNoHan(t, rule.Note)
		}
	}
}
