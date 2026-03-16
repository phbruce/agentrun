// SPDX-License-Identifier: AGPL-3.0-only
//
// agentrun-bridge: MCP JSON-RPC bridge for AgentRun.
//
// Reads JSON-RPC from stdin, forwards to AgentRun MCP server via HTTP,
// writes responses to stdout. Authentication via GitHub OAuth Device Flow
// with tokens stored in the OS keychain.
//
// Usage (Claude Code .mcp.json):
//
//	{ "command": "agentrun-bridge", "env": { "AGENTRUN_SCOPE": "aws" } }
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// version is set at build time via: -ldflags "-X main.version=..."
var version = "0.1.0"

// allowedHosts restricts which hosts the bridge will send tokens to.
// Production hosts are added via AGENTRUN_URL env var and validated at runtime.
var allowedHosts = []string{
	"localhost",
	"127.0.0.1",
}

// maxResponseBytes limits API response body size (10 MB).
const maxResponseBytes = 10 * 1024 * 1024

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "--version", "-v":
			fmt.Println("agentrun-bridge", version)
			return
		case "login":
			token, err := deviceFlowLogin()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Login failed: %v\n", err)
				os.Exit(1)
			}
			if err := storeToken(token); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to store token: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Authenticated successfully. Token stored in keychain.")
			return
		case "logout":
			if err := deleteToken(); err != nil {
				fmt.Fprintf(os.Stderr, "Logout failed: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Token removed from keychain.")
			return
		case "status":
			token, err := loadToken()
			if err != nil || token == "" {
				fmt.Println("Not authenticated. Run: agentrun-bridge login")
				os.Exit(1)
			}
			user, err := getGitHubUser(token)
			if err != nil {
				fmt.Printf("Token invalid or expired: %v\nRun: agentrun-bridge login\n", err)
				os.Exit(1)
			}
			fmt.Printf("Authenticated as: %s\n", user)
			return
		case "update":
			fmt.Println("Checking for updates...")
			rel, err := getLatestRelease()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Failed to check: %v\n", err)
				os.Exit(1)
			}
			if rel == nil || !isNewerVersion(rel.version, version) {
				fmt.Printf("Already up to date (%s)\n", version)
				return
			}
			fmt.Printf("\n  Current: %s\n  Latest:  %s\n\n", version, rel.version)

			autoConfirm := len(os.Args) > 2 && (os.Args[2] == "--yes" || os.Args[2] == "-y")
			if !autoConfirm {
				fmt.Print("Download and install? [y/N] ")
				var answer string
				fmt.Scanln(&answer)
				if strings.ToLower(strings.TrimSpace(answer)) != "y" {
					fmt.Println("Cancelled.")
					return
				}
			}

			fmt.Println("Downloading and verifying SHA256 checksum...")
			if err := selfUpdate(rel); err != nil {
				fmt.Fprintf(os.Stderr, "Update failed: %v\n", err)
				os.Exit(1)
			}
			fmt.Printf("Updated to %s (SHA256 verified).\n", rel.version)
			return
		case "help", "--help", "-h":
			fmt.Println("agentrun-bridge — MCP bridge for AgentRun")
			fmt.Println()
			fmt.Println("Commands:")
			fmt.Println("  (no args)   Run as MCP bridge (stdin/stdout JSON-RPC)")
			fmt.Println("  login       Authenticate with GitHub (Device Flow)")
			fmt.Println("  logout      Remove stored token")
			fmt.Println("  status      Check authentication status")
			fmt.Println("  update      Check and install updates")
			fmt.Println("  version     Print version")
			fmt.Println()
			fmt.Println("Environment:")
			fmt.Println("  AGENTRUN_SCOPE            MCP scope filter (aws, github, jira)")
			fmt.Println("  AGENTRUN_URL              Override API URL")
			fmt.Println("  AGENTRUN_NO_UPDATE_CHECK  Set to 1 to disable update notifications")
			fmt.Println("  AGENTRUN_HOOKS_FILE       Path to JSON hooks config (post-response hooks)")
			return
		}
	}

	// Bridge mode: stdin → HTTP → stdout
	checkForUpdate()
	runBridge()
}

func runBridge() {
	token, _ := loadToken()

	// If no keychain token, attempt interactive login (only if terminal)
	if token == "" && isTerminal() {
		fmt.Fprintln(os.Stderr, "No token found. Starting GitHub authentication...")
		var err error
		token, err = deviceFlowLogin()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Auth failed: %v\n", err)
			os.Exit(1)
		}
		_ = storeToken(token)
	}

	// Fallback to gh CLI token with warning
	if token == "" {
		ghToken := ghAuthToken()
		if ghToken != "" {
			fmt.Fprintln(os.Stderr, "[agentrun] WARNING: Using gh CLI token (broader scope). Run 'agentrun-bridge login' for a dedicated token.")
			token = ghToken
		}
	}

	baseURL := os.Getenv("AGENTRUN_URL")
	if baseURL == "" {
		fmt.Fprintln(os.Stderr, "[agentrun] ERROR: AGENTRUN_URL is required. Set it to your AgentRun MCP server endpoint.")
		fmt.Fprintln(os.Stderr, "[agentrun] Example: AGENTRUN_URL=https://api.example.com/v1/mcp")
		os.Exit(1)
	}

	// Add the configured host to allowlist dynamically
	if parsed, err := url.Parse(baseURL); err == nil {
		host := strings.Split(parsed.Hostname(), ":")[0]
		allowedHosts = append(allowedHosts, host)
	}

	// Validate URL host against allowlist
	if !isAllowedHost(baseURL) {
		fmt.Fprintf(os.Stderr, "[agentrun] ERROR: URL host not in allowlist: %s\n", baseURL)
		fmt.Fprintf(os.Stderr, "[agentrun] Allowed hosts: %s\n", strings.Join(allowedHosts, ", "))
		os.Exit(1)
	}

	scope := os.Getenv("AGENTRUN_SCOPE")
	targetURL := baseURL
	if scope != "" {
		targetURL += "?scope=" + scope
	}

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	client := &http.Client{}

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Validate JSON-RPC structure before forwarding
		if !isValidJsonRpc(line) {
			writeError(line, "invalid JSON-RPC message")
			continue
		}

		body, statusCode, err := post(client, targetURL, token, line)
		if err != nil {
			writeError(line, "bridge connection error")
			fmt.Fprintf(os.Stderr, "[agentrun] HTTP error: %v\n", err)
			continue
		}

		// Re-auth on 401/403 then retry
		if statusCode == 401 || statusCode == 403 {
			newToken, authErr := deviceFlowLogin()
			if authErr == nil {
				token = newToken
				_ = storeToken(token)
				body, _, err = post(client, targetURL, token, line)
				if err != nil {
					writeError(line, "bridge connection error after re-auth")
					fmt.Fprintf(os.Stderr, "[agentrun] HTTP error after re-auth: %v\n", err)
					continue
				}
			}
		}

		// Run post-response hooks (async, non-blocking)
		runPostResponseHooks([]byte(line), body)

		os.Stdout.Write(body)
		fmt.Println()
	}
}

func post(client *http.Client, url, token, body string) ([]byte, int, error) {
	req, err := http.NewRequest("POST", url, bytes.NewBufferString(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	// Limit response body size to prevent OOM
	limited := io.LimitReader(resp.Body, maxResponseBytes)
	respBody, err := io.ReadAll(limited)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	return respBody, resp.StatusCode, nil
}

// writeError sends a JSON-RPC error to stdout so Claude Code sees it.
func writeError(request, message string) {
	var req map[string]any
	id := any(nil)
	if json.Unmarshal([]byte(request), &req) == nil {
		id = req["id"]
	}
	resp := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]any{"code": -32000, "message": message},
	}
	out, _ := json.Marshal(resp)
	os.Stdout.Write(out)
	fmt.Println()
}

// isValidJsonRpc checks that the message has the minimum JSON-RPC fields.
func isValidJsonRpc(line string) bool {
	var msg map[string]any
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		return false
	}
	_, hasJsonrpc := msg["jsonrpc"]
	_, hasMethod := msg["method"]
	return hasJsonrpc && hasMethod
}

// isAllowedHost checks the URL host against the allowlist.
func isAllowedHost(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.Split(parsed.Hostname(), ":")[0]
	for _, allowed := range allowedHosts {
		if host == allowed {
			return true
		}
	}
	return false
}

// ghAuthToken tries to get a token from gh CLI as fallback.
func ghAuthToken() string {
	cmd := execCommand("gh", "auth", "token")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func isTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
