package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

const pluginName = "PrivacyCleanup"

func vencordSettingsFile(d DiscordInstall) string {
	home, _ := os.UserHomeDir()
	var base string
	switch {
	case d.Flatpak:
		base = filepath.Join(home, ".var", "app", flatpakIDOf(d.Path), "config")
	case runtime.GOOS == "windows":
		base = os.Getenv("APPDATA")
	case runtime.GOOS == "darwin":
		base = filepath.Join(home, "Library", "Application Support")
	default:
		base = os.Getenv("XDG_CONFIG_HOME")
		if base == "" {
			base = filepath.Join(home, ".config")
		}
	}
	return filepath.Join(base, "Vencord", "settings", "settings.json")
}

func flatpakIDOf(p string) string {
	return filepath.Base(p)
}

func pluginEnabled(file string) bool {
	data, err := os.ReadFile(file)
	if err != nil {
		return false
	}
	var s struct {
		Plugins map[string]struct {
			Enabled bool `json:"enabled"`
		} `json:"plugins"`
	}
	return json.Unmarshal(data, &s) == nil && s.Plugins[pluginName].Enabled
}

func enablePlugin(file string) error {
	settings := map[string]any{}
	if data, err := os.ReadFile(file); err == nil {
		if err := json.Unmarshal(data, &settings); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	plugins, _ := settings["plugins"].(map[string]any)
	if plugins == nil {
		plugins = map[string]any{}
	}
	entry, _ := plugins[pluginName].(map[string]any)
	if entry == nil {
		entry = map[string]any{}
	}
	entry["enabled"] = true
	plugins[pluginName] = entry
	settings["plugins"] = plugins
	out, err := json.MarshalIndent(settings, "", "    ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}
