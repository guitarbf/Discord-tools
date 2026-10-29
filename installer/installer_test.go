package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeAsar(t *testing.T, file, patcher string) {
	t.Helper()
	b, _ := json.Marshal(patcher)
	index := "require(" + string(b) + ")"
	header := `{"files":{"index.js":{"size":` + itoa(len(index)) + `,"offset":"0"}}}`
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, n := range []uint32{4, uint32(len(header) + 8), uint32(len(header) + 4), uint32(len(header))} {
		_ = binary.Write(f, binary.LittleEndian, n)
	}
	_, _ = f.WriteString(header + index)
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func fakeCheckout(t *testing.T, dir string) {
	t.Helper()
	must(t, os.MkdirAll(filepath.Join(dir, "src", "plugins"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"vencord","packageManager":"pnpm@10.4.1"}`), 0o644))
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func fakeDiscord(t *testing.T, root string) DiscordInstall {
	r := filepath.Join(root, "discord", "resources")
	must(t, os.MkdirAll(r, 0o755))
	must(t, os.WriteFile(filepath.Join(r, "app.asar"), []byte("original"), 0o644))
	return DiscordInstall{Branch: "stable", Path: filepath.Join(root, "discord"), Resources: r}
}

func TestInspectResources(t *testing.T) {
	root := t.TempDir()
	d := fakeDiscord(t, root)
	inspectResources(&d)
	if d.Patched || d.Kind != "none" {
		t.Fatalf("unpatched: %+v", d)
	}

	vencord := filepath.Join(root, "Vencord")
	fakeCheckout(t, vencord)
	must(t, os.Rename(filepath.Join(d.Resources, "app.asar"), filepath.Join(d.Resources, "_app.asar")))
	writeAsar(t, filepath.Join(d.Resources, "app.asar"), filepath.Join(vencord, "dist", "patcher.js"))
	inspectResources(&d)
	if !d.Patched || d.Kind != "source" || !samePath(d.VencordDir, vencord) {
		t.Fatalf("source: %+v", d)
	}

	writeAsar(t, filepath.Join(d.Resources, "app.asar"), filepath.Join(root, "AppData", "Vencord", "dist", "patcher.js"))
	inspectResources(&d)
	if d.Kind != "official" {
		t.Fatalf("official: %+v", d)
	}
}

func baseStatus(t *testing.T, root string) Status {
	d := fakeDiscord(t, root)
	inspectResources(&d)
	return Status{
		BundledVersion: "0.1.0",
		Git:            Tool{Name: "Git", OK: true, Path: "/usr/bin/git"},
		Node:           Tool{Name: "Node.js", OK: true, Path: "/usr/bin/node"},
		Discords:       []DiscordInstall{d},
		SuggestedDir:   filepath.Join(root, "Vencord"),
	}
}

func stepIDs(p Plan) string {
	var ids []string
	for _, s := range p.Steps {
		ids = append(ids, s.ID)
	}
	return strings.Join(ids, ",")
}

func TestPlanInstall(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	root := t.TempDir()
	st := baseStatus(t, root)

	if p := planInstall(Status{}, Request{}); !strings.Contains(p.Blocker, "Discord") {
		t.Fatalf("no discord: %+v", p)
	}

	p := planInstall(st, Request{RestartDiscord: true})
	if p.Blocker != "" || stepIDs(p) != "clone,deps,plugin,build,inject,enable,restart" {
		t.Fatalf("fresh: %s %s", p.Blocker, stepIDs(p))
	}

	missing := st
	missing.Node = Tool{Name: "Node.js"}
	if p := planInstall(missing, Request{}); !strings.Contains(p.Blocker, "Node.js") {
		t.Fatalf("missing tools without package manager: %+v", p)
	}
	missing.PackageManager = "winget"
	if p := planInstall(missing, Request{}); !strings.Contains(p.Blocker, "Tick") {
		t.Fatalf("not opted in: %+v", p)
	}
	if p := planInstall(missing, Request{InstallPrereqs: true}); p.Blocker != "" || !strings.HasPrefix(stepIDs(p), "prereqs,clone") {
		t.Fatalf("opted in: %+v", p)
	}

	occupied := filepath.Join(root, "busy")
	must(t, os.MkdirAll(occupied, 0o755))
	must(t, os.WriteFile(filepath.Join(occupied, "x"), nil, 0o644))
	if p := planInstall(st, Request{VencordDir: occupied}); !strings.Contains(p.Blocker, "isn't a Vencord") {
		t.Fatalf("occupied: %+v", p)
	}
	if p := planInstall(st, Request{VencordDir: "relative/dir"}); p.Blocker == "" {
		t.Fatal("relative path accepted")
	}

	vencord := filepath.Join(root, "Vencord")
	fakeCheckout(t, vencord)
	d := st.Discords[0]
	must(t, os.Rename(filepath.Join(d.Resources, "app.asar"), filepath.Join(d.Resources, "_app.asar")))
	writeAsar(t, filepath.Join(d.Resources, "app.asar"), filepath.Join(vencord, "dist", "patcher.js"))
	inspectResources(&d)
	st.Discords[0] = d
	must(t, enablePlugin(vencordSettingsFile(d)))
	if p := planInstall(st, Request{VencordDir: vencord}); stepIDs(p) != "deps,plugin,build" {
		t.Fatalf("already injected and enabled: %s", stepIDs(p))
	}
}

func TestPluginWriteAndVersion(t *testing.T) {
	dir := t.TempDir()
	fakeCheckout(t, dir)
	if installedPluginVersion(dir) != "" {
		t.Fatal("expected not installed")
	}
	must(t, writePlugin(dir))
	if !exists(filepath.Join(pluginDir(dir), "index.tsx")) || !exists(filepath.Join(pluginDir(dir), "src", "app.ts")) {
		t.Fatal("plugin files missing")
	}
	if v := installedPluginVersion(dir); v != bundledVersion() {
		t.Fatalf("version %q", v)
	}
	must(t, writePlugin(dir))
	must(t, removePlugin(dir))
	if installedPluginVersion(dir) != "" {
		t.Fatal("expected removed")
	}
}

func TestEnablePluginPreservesSettings(t *testing.T) {
	file := filepath.Join(t.TempDir(), "settings", "settings.json")
	must(t, os.MkdirAll(filepath.Dir(file), 0o755))
	must(t, os.WriteFile(file, []byte(`{"autoUpdate":false,"plugins":{"Other":{"enabled":true,"x":1}}}`), 0o644))
	must(t, enablePlugin(file))
	if !pluginEnabled(file) {
		t.Fatal("not enabled")
	}
	var s map[string]any
	data, _ := os.ReadFile(file)
	must(t, json.Unmarshal(data, &s))
	other := s["plugins"].(map[string]any)["Other"].(map[string]any)
	if s["autoUpdate"] != false || other["x"] != float64(1) {
		t.Fatalf("settings changed: %s", data)
	}
	fresh := filepath.Join(t.TempDir(), "new", "settings.json")
	must(t, enablePlugin(fresh))
	if !pluginEnabled(fresh) {
		t.Fatal("fresh not enabled")
	}
}

func TestJob(t *testing.T) {
	var j Job
	ran := []string{}
	must(t, j.Start("x", []stepFunc{
		{"a", "A", func(context.Context) error { ran = append(ran, "a"); return nil }},
		{"b", "B", func(context.Context) error { return errors.New("boom") }},
		{"c", "C", func(context.Context) error { ran = append(ran, "c"); return nil }},
	}))
	for j.Running() {
		time.Sleep(5 * time.Millisecond)
	}
	s := j.Snapshot()
	if s.Done || s.Error != "boom" || strings.Join(ran, ",") != "a" || s.Steps[2].Status != "skipped" {
		t.Fatalf("%+v", s)
	}
}

func TestServerSecurity(t *testing.T) {
	s := newServer()
	s.host = "127.0.0.1:1234"
	h := s.handler()
	do := func(method, target, host, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, nil)
		r.Host = host
		if token != "" {
			r.Header.Set("X-Token", token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := do("GET", "/?t="+s.token, "evil.example:1234", ""); w.Code != http.StatusForbidden {
		t.Fatal("foreign host allowed")
	}
	if w := do("GET", "/?t=wrong", s.host, ""); w.Code != http.StatusForbidden {
		t.Fatal("bad token allowed")
	}
	w := do("GET", "/?t="+s.token, s.host, "")
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Security-Policy"), "nonce-") || strings.Contains(w.Body.String(), "{{NONCE}}") {
		t.Fatalf("index: %d", w.Code)
	}
	if w := do("POST", "/api/ping", s.host, ""); w.Code != http.StatusForbidden {
		t.Fatal("api without token allowed")
	}
	if w := do("GET", "/api/ping", s.host, s.token); w.Code != http.StatusForbidden {
		t.Fatal("GET api allowed")
	}
	if w := do("POST", "/api/ping", s.host, s.token); w.Code != 200 {
		t.Fatalf("ping: %d", w.Code)
	}
}

func TestStripANSIAndCR(t *testing.T) {
	if stripANSI("\x1b[32mok\x1b[0m") != "ok" {
		t.Fatal("ansi")
	}
	var lines []string
	pump(strings.NewReader("a\r\nb\rc\n"), func(l string) { lines = append(lines, l) })
	if strings.Join(lines, ",") != "a,b,c" {
		t.Fatal(lines)
	}
}

func TestKnownLocationsPerTool(t *testing.T) {
	t.Setenv("ProgramFiles", `C:\Program Files`)
	t.Setenv("LOCALAPPDATA", `C:\Users\u\AppData\Local`)
	t.Setenv("APPDATA", `C:\Users\u\AppData\Roaming`)
	for _, name := range []string{"pnpm", "winget", "brew", "git"} {
		for _, p := range knownLocations("windows", name) {
			if strings.Contains(strings.ToLower(p), "node.exe") {
				t.Fatalf("%s resolves to node: %s", name, p)
			}
		}
	}
	if len(knownLocations("windows", "brew")) != 0 {
		t.Fatal("unknown tool should have no locations")
	}
}

func TestPnpmCommandUsesNpxCLI(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	root := t.TempDir()
	nodeDir := filepath.Join(root, "nodejs")
	cli := filepath.Join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js")
	must(t, os.MkdirAll(filepath.Dir(cli), 0o755))
	must(t, os.WriteFile(cli, nil, 0o644))
	vencord := filepath.Join(root, "Vencord")
	fakeCheckout(t, vencord)
	name, args := pnpmCommand(Tool{Path: filepath.Join(nodeDir, "node.exe")}, vencord)
	if !strings.HasSuffix(name, "node.exe") || len(args) != 3 || args[0] != cli || args[2] != "pnpm@10.4.1" {
		t.Fatalf("%s %v", name, args)
	}
}
