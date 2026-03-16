// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// HookDef defines a post-response hook triggered after a tools/call response.
type HookDef struct {
	Name    string    `json:"name"`
	Match   HookMatch `json:"match"`
	Action  string    `json:"action"` // "exec" or "log"
	Command string    `json:"command"`
}

// HookMatch defines conditions for triggering a hook.
type HookMatch struct {
	Tool     string `json:"tool"`     // tool name to match (exact or prefix with *)
	Contains string `json:"contains"` // substring match on result text
}

// HooksConfig is loaded from AGENTRUN_HOOKS_FILE.
type HooksConfig struct {
	Hooks []HookDef `json:"hooks"`
}

var loadedHooks *HooksConfig

// hooksDir returns the safe directory for hooks files.
func hooksDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "agentrun")
}

// loadHooks reads hook definitions from the file specified by AGENTRUN_HOOKS_FILE.
func loadHooks() []HookDef {
	if loadedHooks != nil {
		return loadedHooks.Hooks
	}

	hooksFile := os.Getenv("AGENTRUN_HOOKS_FILE")
	if hooksFile == "" {
		loadedHooks = &HooksConfig{}
		return nil
	}

	// Validate hooks file is within the safe directory
	absPath, err := filepath.Abs(hooksFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[hooks] Invalid hooks file path: %v\n", err)
		loadedHooks = &HooksConfig{}
		return nil
	}

	safeDir := hooksDir()
	if !strings.HasPrefix(absPath, safeDir) {
		fmt.Fprintf(os.Stderr, "[hooks] Hooks file must be under %s (got: %s)\n", safeDir, absPath)
		loadedHooks = &HooksConfig{}
		return nil
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[hooks] Failed to read hooks file %s: %v\n", absPath, err)
		loadedHooks = &HooksConfig{}
		return nil
	}

	var config HooksConfig
	if err := json.Unmarshal(data, &config); err != nil {
		fmt.Fprintf(os.Stderr, "[hooks] Failed to parse hooks file: %v\n", err)
		loadedHooks = &HooksConfig{}
		return nil
	}

	loadedHooks = &config
	if len(config.Hooks) > 0 {
		fmt.Fprintf(os.Stderr, "[hooks] Loaded %d hook(s) from %s\n", len(config.Hooks), absPath)
	}
	return config.Hooks
}

// runPostResponseHooks checks if any hooks match the response and executes them.
func runPostResponseHooks(request, response []byte) {
	hooks := loadHooks()
	if len(hooks) == 0 {
		return
	}

	var req map[string]any
	if err := json.Unmarshal(request, &req); err != nil {
		return
	}

	method, _ := req["method"].(string)
	if method != "tools/call" {
		return
	}

	params, _ := req["params"].(map[string]any)
	toolName, _ := params["name"].(string)
	if toolName == "" {
		return
	}

	var resp map[string]any
	if err := json.Unmarshal(response, &resp); err != nil {
		return
	}

	result, _ := resp["result"].(map[string]any)
	resultText := extractResultText(result)

	for _, hook := range hooks {
		if !matchesHook(hook, toolName, resultText) {
			continue
		}
		go executeHook(hook, toolName, resultText)
	}
}

func matchesHook(hook HookDef, toolName, resultText string) bool {
	if hook.Match.Tool != "" {
		if strings.HasSuffix(hook.Match.Tool, "*") {
			prefix := strings.TrimSuffix(hook.Match.Tool, "*")
			if !strings.HasPrefix(toolName, prefix) {
				return false
			}
		} else if hook.Match.Tool != toolName {
			return false
		}
	}

	if hook.Match.Contains != "" {
		if !strings.Contains(resultText, hook.Match.Contains) {
			return false
		}
	}

	return true
}

func executeHook(hook HookDef, toolName, resultText string) {
	switch hook.Action {
	case "log":
		fmt.Fprintf(os.Stderr, "[hook:%s] tool=%s result_length=%d\n",
			sanitize(hook.Name), sanitize(toolName), len(resultText))
	case "exec":
		if hook.Command == "" {
			return
		}
		// Pass data via environment variables instead of string interpolation
		// to prevent command injection (security fix for C1)
		summary := resultText
		if len(summary) > 1000 {
			summary = summary[:1000]
		}

		cmd := exec.Command("sh", "-c", hook.Command)
		cmd.Env = append(os.Environ(),
			"AGENTRUN_HOOK_TOOL="+toolName,
			"AGENTRUN_HOOK_RESULT="+summary,
		)
		cmd.Stderr = os.Stderr

		out, err := cmd.Output()
		if err != nil {
			fmt.Fprintf(os.Stderr, "[hook:%s] exec failed: %v\n", sanitize(hook.Name), err)
		}
		if len(out) > 0 {
			fmt.Fprintf(os.Stderr, "[hook:%s] %s\n", sanitize(hook.Name), strings.TrimSpace(string(out)))
		}
	default:
		fmt.Fprintf(os.Stderr, "[hook:%s] unknown action: %s\n", sanitize(hook.Name), hook.Action)
	}
}

// extractResultText pulls text content from a JSON-RPC tools/call result.
func extractResultText(result map[string]any) string {
	if result == nil {
		return ""
	}

	content, ok := result["content"].([]any)
	if !ok {
		b, _ := json.Marshal(result)
		return string(b)
	}

	var texts []string
	for _, c := range content {
		item, ok := c.(map[string]any)
		if !ok {
			continue
		}
		if t, _ := item["type"].(string); t == "text" {
			if text, _ := item["text"].(string); text != "" {
				texts = append(texts, text)
			}
		}
	}
	return strings.Join(texts, "\n")
}
