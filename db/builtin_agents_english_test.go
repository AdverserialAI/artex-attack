package db

import (
	"testing"
	"unicode"
)

func TestBuiltinAgentDisplayTextIsEnglish(t *testing.T) {
	assertEnglish := func(field, value string) {
		t.Helper()
		for _, r := range value {
			if unicode.Is(unicode.Han, r) {
				t.Fatalf("%s still contains Chinese: %q", field, value)
			}
		}
	}
	for _, agent := range builtinAgents {
		assertEnglish(agent.key+" name", agent.name)
		assertEnglish(agent.key+" description", agent.desc)
		for _, variable := range agent.vars {
			assertEnglish(agent.key+" "+variable.name+" description", variable.desc)
			assertEnglish(agent.key+" "+variable.name+" example", variable.example)
		}
	}
}
