package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type DiscordInstall struct {
	Branch      string `json:"branch"`
	Path        string `json:"path"`
	Resources   string `json:"resources"`
	Flatpak     bool   `json:"flatpak"`
	Patched     bool   `json:"patched"`
	PatcherPath string `json:"patcherPath"`
	VencordDir  string `json:"vencordDir"`
	Kind        string `json:"kind"`
	Writable    bool   `json:"writable"`
}

var requirePattern = regexp.MustCompile(`require\(("(?:[^"\\]|\\.)*")\)`)

func readPatcherPath(appAsar string) string {
	f, err := os.Open(appAsar)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf, _ := io.ReadAll(io.LimitReader(f, 64*1024))
	m := requirePattern.FindSubmatch(buf)
	if m == nil {
		return ""
	}
	var p string
	if json.Unmarshal(m[1], &p) != nil {
		return ""
	}
	return p
}

func inspectResources(d *DiscordInstall) {
	d.Writable = dirWritable(d.Resources)
	d.Kind = "none"
	if !exists(filepath.Join(d.Resources, "_app.asar")) {
		return
	}
	d.Patched = true
	d.Kind = "other"
	d.PatcherPath = readPatcherPath(filepath.Join(d.Resources, "app.asar"))
	if d.PatcherPath == "" {
		return
	}
	base := filepath.Dir(filepath.Dir(d.PatcherPath))
	if isVencordCheckout(base) {
		d.Kind = "source"
		d.VencordDir = base
	} else if strings.EqualFold(filepath.Base(filepath.Dir(d.PatcherPath)), "dist") {
		d.Kind = "official"
	}
}

func isVencordCheckout(dir string) bool {
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return false
	}
	var pkg struct{ Name string }
	if json.Unmarshal(data, &pkg) != nil || pkg.Name != "vencord" {
		return false
	}
	return exists(filepath.Join(dir, "src", "plugins"))
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func dirWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".pc-write-test-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

func samePath(a, b string) bool {
	ca, err1 := filepath.Abs(a)
	cb, err2 := filepath.Abs(b)
	if err1 != nil || err2 != nil {
		return false
	}
	if isWindows() {
		return strings.EqualFold(filepath.Clean(ca), filepath.Clean(cb))
	}
	return filepath.Clean(ca) == filepath.Clean(cb)
}

func findDiscords() []DiscordInstall {
	var out []DiscordInstall
	for _, d := range discordCandidates() {
		inspectResources(&d)
		out = append(out, d)
	}
	return out
}
