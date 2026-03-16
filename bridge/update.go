// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

const (
	updateRepo      = "phbruce/agentrun"
	updateTagPrefix = "bridge-v"
	checkInterval   = 24 * time.Hour
)

// checkFilePath returns the path to the update check timestamp file.
func checkFilePath() string {
	dir, _ := os.UserCacheDir()
	return filepath.Join(dir, "agentrun-bridge", "last-update-check")
}

// shouldCheckUpdate returns true if we haven't checked in the last 24h.
func shouldCheckUpdate() bool {
	if os.Getenv("AGENTRUN_NO_UPDATE_CHECK") == "1" {
		return false
	}
	data, err := os.ReadFile(checkFilePath())
	if err != nil {
		return true
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(string(data)))
	if err != nil {
		return true
	}
	return time.Since(t) > checkInterval
}

// markChecked writes the current timestamp.
func markChecked() {
	path := checkFilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(time.Now().Format(time.RFC3339)), 0o644)
}

// isNewerVersion compares two semantic versions. Returns true if candidate > current.
func isNewerVersion(candidate, current string) bool {
	// Ensure "v" prefix for semver package
	c := candidate
	if !strings.HasPrefix(c, "v") {
		c = "v" + c
	}
	cur := current
	if !strings.HasPrefix(cur, "v") {
		cur = "v" + cur
	}

	if !semver.IsValid(c) || !semver.IsValid(cur) {
		// Fallback to string comparison if not valid semver
		return candidate > current
	}

	return semver.Compare(c, cur) > 0
}

// checkForUpdate checks GitHub Releases for a newer version.
func checkForUpdate() {
	if !shouldCheckUpdate() {
		return
	}

	go func() {
		defer markChecked()

		rel, err := getLatestRelease()
		if err != nil || rel == nil {
			return
		}

		if !isNewerVersion(rel.version, version) {
			return
		}

		fmt.Fprintf(os.Stderr, "[agentrun] New version available: %s → %s\n", version, rel.version)
		fmt.Fprintf(os.Stderr, "[agentrun] Update with: agentrun-bridge update\n")
	}()
}

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type releaseResult struct {
	version      string
	binaryAsset  releaseAsset
	checksumData string
}

// updateToken returns the best token for GitHub API calls.
func updateToken() string {
	// For update checks, prefer gh CLI (public repo, no token leak risk)
	token := ghAuthToken()
	if token == "" {
		token, _ = loadToken()
	}
	return token
}

// getLatestRelease fetches the latest release matching our tag prefix.
func getLatestRelease() (*releaseResult, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=10", updateRepo)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Accept", "application/vnd.github+json")

	token := updateToken()
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var releases []struct {
		TagName string         `json:"tag_name"`
		Assets  []releaseAsset `json:"assets"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, err
	}

	assetName := fmt.Sprintf("agentrun-bridge-%s-%s", runtime.GOOS, runtime.GOARCH)

	for _, rel := range releases {
		if !strings.HasPrefix(rel.TagName, updateTagPrefix) {
			continue
		}
		ver := strings.TrimPrefix(rel.TagName, updateTagPrefix)
		for _, asset := range rel.Assets {
			if asset.Name == assetName {
				return &releaseResult{
					version:     ver,
					binaryAsset: asset,
				}, nil
			}
		}
	}

	return nil, nil
}

// downloadAsset downloads a release asset using the GitHub API.
func downloadAsset(assetURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", assetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/octet-stream")

	token := updateToken()
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	// Limit download size to 50 MB
	return io.ReadAll(io.LimitReader(resp.Body, 50*1024*1024))
}

// fetchChecksumForRelease finds SHA256SUMS in the same release.
func fetchChecksumForRelease(assetName string) (string, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=10", updateRepo)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Accept", "application/vnd.github+json")

	token := updateToken()
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var releases []struct {
		TagName string         `json:"tag_name"`
		Assets  []releaseAsset `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return "", err
	}

	for _, rel := range releases {
		if !strings.HasPrefix(rel.TagName, updateTagPrefix) {
			continue
		}
		for _, asset := range rel.Assets {
			if asset.Name == "SHA256SUMS" {
				body, err := downloadAsset(asset.URL)
				if err != nil {
					return "", fmt.Errorf("failed to download SHA256SUMS: %w", err)
				}
				for _, line := range strings.Split(string(body), "\n") {
					parts := strings.Fields(line)
					if len(parts) == 2 && parts[1] == assetName {
						return parts[0], nil
					}
				}
				return "", fmt.Errorf("checksum for %s not found in SHA256SUMS", assetName)
			}
		}
		break
	}

	return "", fmt.Errorf("SHA256SUMS asset not found in release")
}

// selfUpdate downloads the new binary, verifies SHA256, and replaces the current one.
func selfUpdate(rel *releaseResult) error {
	assetName := fmt.Sprintf("agentrun-bridge-%s-%s", runtime.GOOS, runtime.GOARCH)

	expectedHash, err := fetchChecksumForRelease(assetName)
	if err != nil {
		return fmt.Errorf("checksum verification failed: %w", err)
	}

	binaryData, err := downloadAsset(rel.binaryAsset.URL)
	if err != nil {
		return err
	}

	hasher := sha256.New()
	hasher.Write(binaryData)
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if actualHash != expectedHash {
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", expectedHash, actualHash)
	}

	execPath, err := os.Executable()
	if err != nil {
		return err
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return err
	}

	tmpPath := execPath + ".tmp"
	if err := os.WriteFile(tmpPath, binaryData, 0o755); err != nil {
		return err
	}

	if err := os.Rename(tmpPath, execPath); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return nil
}
