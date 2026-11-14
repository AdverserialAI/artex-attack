package server

import (
	"testing"
	"unicode"

	"artex/agent"
	"artex/db"
)

func requireNoHan(t *testing.T, value string) {
	t.Helper()
	for _, r := range value {
		if unicode.Is(unicode.Han, r) {
			t.Fatalf("display text still contains Chinese: %q", value)
		}
	}
}

func TestEnglishDisplayText(t *testing.T) {
	for _, value := range scenarioDisplayNames {
		requireNoHan(t, value)
	}
	for _, value := range interceptRuleDisplayNames {
		requireNoHan(t, value)
	}
	for _, value := range interceptRuleDisplayMessages {
		requireNoHan(t, value)
	}
	for _, value := range assetInterceptDisplayNotes {
		requireNoHan(t, value)
	}
	for _, value := range toolDisplayDescriptions {
		requireNoHan(t, value)
	}
	for _, variable := range globalPromptVars {
		requireNoHan(t, variable.Description)
		requireNoHan(t, variable.Example)
	}
	for _, seed := range agent.BuiltinToolSeeds() {
		if _, ok := builtinToolDisplayDescriptions[seed.Key]; !ok {
			t.Errorf("tool %s has no English description", seed.Key)
		}
	}
}

func TestLocalizeToolPreservesCustomDescription(t *testing.T) {
	translation, ok := builtinToolDisplayDescriptions["list_goals"]
	if !ok {
		t.Fatal("list_goals translation is missing")
	}
	tool := &db.Tool{Key: "list_goals", System: true, Description: translation.legacy}
	localizeTool(tool)
	if tool.Description != translation.english {
		t.Fatalf("default description = %q, want English", tool.Description)
	}

	tool.Description = "My customized description"
	localizeTool(tool)
	if tool.Description != "My customized description" {
		t.Fatalf("custom description was overwritten: %q", tool.Description)
	}

	customTool := &db.Tool{Key: "list_goals", System: false, Description: translation.legacy}
	localizeTool(customTool)
	if customTool.Description != translation.legacy {
		t.Fatal("non-system tool description was changed")
	}
}

func TestLocalizeScenarioAndTemplate(t *testing.T) {
	category := &db.TaskCategory{Name: "内网渗透"}
	localizeTaskCategory(category)
	if category.Name != "Internal Penetration Testing" {
		t.Fatalf("category name = %q", category.Name)
	}
	category.Name = "Customer category"
	localizeTaskCategory(category)
	if category.Name != "Customer category" {
		t.Fatalf("custom category was changed: %q", category.Name)
	}

	planner := &db.PlannerTemplate{Name: "外网渗透", Builtin: true}
	plannerTemplatesAPI.localize(planner)
	if planner.Name != "External Penetration Testing" {
		t.Fatalf("planner template name = %q", planner.Name)
	}
	worker := &db.WorkerTemplate{Name: "权限提升", Builtin: true}
	workerTemplatesAPI.localize(worker)
	if worker.Name != "Privilege Escalation" {
		t.Fatalf("worker template name = %q", worker.Name)
	}

	archive := &db.TaskArchive{CategoryNameSnapshot: "代码审计"}
	localizeTaskArchive(archive)
	if archive.CategoryNameSnapshot != "Code Audit" {
		t.Fatalf("archive category = %q", archive.CategoryNameSnapshot)
	}
}

func TestLocalizeInterceptApprovals(t *testing.T) {
	const legacyName = "[内置] 破坏性系统命令"
	const legacyMessage = "破坏性命令被拒绝（rm -rf / / mkfs / dd / fork bomb / 关机重启 / 覆写磁盘设备）"
	rule := db.InterceptRule{Name: legacyName, Message: legacyMessage}
	localizeInterceptRule(&rule)
	requireNoHan(t, rule.Name)
	requireNoHan(t, rule.Message)

	row := db.InterceptApprovalRow{RuleName: legacyName}
	row.Reason = legacyMessage
	detail := &db.InterceptDetail{
		InterceptApprovalRow: row,
		Audit: &db.InterceptAudit{
			InitialReason:  legacyMessage,
			DecisionReason: legacyMessage,
			RuleName:       legacyName,
		},
	}
	localizeInterceptDetail(detail)
	requireNoHan(t, detail.Reason)
	requireNoHan(t, detail.RuleName)
	requireNoHan(t, detail.Audit.InitialReason)
	requireNoHan(t, detail.Audit.DecisionReason)
	requireNoHan(t, detail.Audit.RuleName)

	custom := db.InterceptRule{Name: "自定义规则", Message: "自定义说明"}
	localizeInterceptRule(&custom)
	if custom.Name != "自定义规则" || custom.Message != "自定义说明" {
		t.Fatal("custom rule text was overwritten")
	}
}
