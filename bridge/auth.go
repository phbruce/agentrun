// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "agentrun"
	keyringAccount = "github-token"

	// GitHub OAuth Device Flow endpoints
	githubDeviceURL = "https://github.com/login/device/code"
	githubTokenURL  = "https://github.com/login/oauth/access_token"
	githubUserURL   = "https://api.github.com/user"

	// OAuth App client ID — public, safe to embed (Device Flow has no secret)
	githubClientID = "Ov23liEOaNLLxnoD3qNT"

	// Maximum time to wait for user to complete device flow
	deviceFlowTimeout = 15 * time.Minute
)

// deviceFlowLogin performs GitHub OAuth Device Flow authentication.
func deviceFlowLogin() (string, error) {
	resp, err := http.PostForm(githubDeviceURL, url.Values{
		"client_id": {githubClientID},
		"scope":     {"read:org read:user"},
	})
	if err != nil {
		return "", fmt.Errorf("device code request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	params, _ := url.ParseQuery(string(body))

	deviceCode := params.Get("device_code")
	userCode := params.Get("user_code")
	verificationURI := params.Get("verification_uri")
	interval := 5

	if deviceCode == "" || userCode == "" {
		return "", fmt.Errorf("invalid device code response: %s", string(body))
	}

	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "╔══════════════════════════════════════════════╗")
	fmt.Fprintln(os.Stderr, "║       AgentRun — GitHub Authentication       ║")
	fmt.Fprintln(os.Stderr, "╠══════════════════════════════════════════════╣")
	fmt.Fprintf(os.Stderr, "║  1. Open: %-34s  ║\n", verificationURI)
	fmt.Fprintf(os.Stderr, "║  2. Enter code: %-27s  ║\n", userCode)
	fmt.Fprintln(os.Stderr, "║  3. Authorize access                         ║")
	fmt.Fprintln(os.Stderr, "╚══════════════════════════════════════════════╝")
	fmt.Fprintln(os.Stderr)

	_ = openBrowser(verificationURI)

	fmt.Fprint(os.Stderr, "Waiting for authorization")
	deadline := time.Now().Add(deviceFlowTimeout)

	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(interval) * time.Second)
		fmt.Fprint(os.Stderr, ".")

		tokenResp, err := http.PostForm(githubTokenURL, url.Values{
			"client_id":   {githubClientID},
			"device_code": {deviceCode},
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
		})
		if err != nil {
			continue
		}

		tokenBody, _ := io.ReadAll(tokenResp.Body)
		tokenResp.Body.Close()
		tokenParams, _ := url.ParseQuery(string(tokenBody))

		accessToken := tokenParams.Get("access_token")
		errCode := tokenParams.Get("error")

		switch {
		case accessToken != "":
			fmt.Fprintln(os.Stderr, " OK!")
			return accessToken, nil
		case errCode == "authorization_pending":
			continue
		case errCode == "slow_down":
			interval += 5
			continue
		case errCode == "expired_token":
			fmt.Fprintln(os.Stderr, " expired!")
			return "", fmt.Errorf("device code expired, try again")
		case errCode == "access_denied":
			fmt.Fprintln(os.Stderr, " denied!")
			return "", fmt.Errorf("user denied access")
		default:
			return "", fmt.Errorf("unexpected response: %s", string(tokenBody))
		}
	}

	return "", fmt.Errorf("authentication timed out after %v", deviceFlowTimeout)
}

// getGitHubUser returns the authenticated user's login.
func getGitHubUser(token string) (string, error) {
	req, _ := http.NewRequest("GET", githubUserURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var user struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return "", err
	}
	return user.Login, nil
}

// storeToken saves the token in the OS keychain.
func storeToken(token string) error {
	return keyring.Set(keyringService, keyringAccount, token)
}

// loadToken reads the token from the OS keychain.
func loadToken() (string, error) {
	return keyring.Get(keyringService, keyringAccount)
}

// deleteToken removes the token from the OS keychain.
func deleteToken() error {
	return keyring.Delete(keyringService, keyringAccount)
}

// openBrowser tries to open a URL in the default browser (cross-platform).
func openBrowser(u string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", u).Start()
	case "linux":
		return exec.Command("xdg-open", u).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	default:
		return nil
	}
}

// execCommand wraps exec.Command for testability.
var execCommand = exec.Command

// sanitize removes newlines from strings for safe log output.
func sanitize(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\n", ""), "\r", "")
}
