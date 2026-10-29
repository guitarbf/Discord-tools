package main

//go:generate go run ./internal/genpayload

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:payload
var payloadFS embed.FS

const pluginFolder = "privacyCleanup"
const versionFile = ".installed-version"

func bundledVersion() string {
	data, err := payloadFS.ReadFile("payload/VERSION")
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(data))
}

func pluginDir(vencordDir string) string {
	return filepath.Join(vencordDir, "src", "userplugins", pluginFolder)
}

func installedPluginVersion(vencordDir string) string {
	dir := pluginDir(vencordDir)
	if _, err := os.Stat(filepath.Join(dir, "index.tsx")); err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(dir, versionFile))
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(data))
}

func writePlugin(vencordDir string) error {
	dir := pluginDir(vencordDir)
	tmp := dir + ".tmp"
	if err := os.RemoveAll(tmp); err != nil {
		return err
	}
	sub, err := fs.Sub(payloadFS, "payload/plugin")
	if err != nil {
		return err
	}
	err = fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(tmp, filepath.FromSlash(p))
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := fs.ReadFile(sub, p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(tmp, versionFile), []byte(bundledVersion()), 0o644); err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return os.Rename(tmp, dir)
}

func removePlugin(vencordDir string) error {
	return os.RemoveAll(pluginDir(vencordDir))
}
