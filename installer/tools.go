package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

const minNodeMajor = 20

type Tool struct {
	Name    string `json:"name"`
	Found   bool   `json:"found"`
	Path    string `json:"path"`
	Version string `json:"version"`
	OK      bool   `json:"ok"`
	Note    string `json:"note"`
}

func knownLocations(name string) []string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		pf := os.Getenv("ProgramFiles")
		pf86 := os.Getenv("ProgramFiles(x86)")
		local := os.Getenv("LOCALAPPDATA")
		if name == "git" {
			return []string{filepath.Join(pf, "Git", "cmd", "git.exe"), filepath.Join(pf86, "Git", "cmd", "git.exe"), filepath.Join(local, "Programs", "Git", "cmd", "git.exe")}
		}
		return []string{filepath.Join(pf, "nodejs", "node.exe"), filepath.Join(pf86, "nodejs", "node.exe"), filepath.Join(local, "Programs", "nodejs", "node.exe")}
	case "darwin":
		return []string{"/opt/homebrew/bin/" + name, "/usr/local/bin/" + name, "/usr/bin/" + name}
	default:
		return []string{"/usr/local/bin/" + name, "/usr/bin/" + name, filepath.Join(home, ".local", "bin", name)}
	}
}

func findBinary(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, p := range knownLocations(name) {
		if p != "" && exists(p) {
			return p
		}
	}
	return ""
}

var versionPattern = regexp.MustCompile(`(\d+)\.(\d+)\.?(\d+)?`)

func toolVersion(path string, args ...string) string {
	cmd := exec.Command(path, args...)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return versionPattern.FindString(string(out))
}

func detectGit() Tool {
	t := Tool{Name: "Git"}
	if t.Path = findBinary("git"); t.Path != "" {
		t.Found = true
		t.Version = toolVersion(t.Path, "--version")
		t.OK = t.Version != ""
		if !t.OK {
			t.Note = "Found but not working"
		}
	}
	return t
}

func detectNode() Tool {
	t := Tool{Name: "Node.js"}
	if t.Path = findBinary("node"); t.Path == "" {
		return t
	}
	t.Found = true
	t.Version = toolVersion(t.Path, "--version")
	major, _ := strconv.Atoi(strings.SplitN(t.Version, ".", 2)[0])
	t.OK = major >= minNodeMajor
	if !t.OK {
		t.Note = "Version " + strconv.Itoa(minNodeMajor) + " or newer is needed"
	}
	return t
}

func packageManager() string {
	switch runtime.GOOS {
	case "windows":
		if findBinary("winget") != "" || exists(filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WindowsApps", "winget.exe")) {
			return "winget"
		}
	case "darwin":
		if findBinary("brew") != "" {
			return "brew"
		}
	}
	return ""
}

func wingetPath() string {
	if p := findBinary("winget"); p != "" {
		return p
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WindowsApps", "winget.exe")
}

func pnpmVersion(vencordDir string) string {
	data, err := os.ReadFile(filepath.Join(vencordDir, "package.json"))
	if err != nil {
		return ""
	}
	var pkg struct {
		PackageManager string `json:"packageManager"`
	}
	_ = json.Unmarshal(data, &pkg)
	if v, ok := strings.CutPrefix(pkg.PackageManager, "pnpm@"); ok {
		return strings.SplitN(v, "+", 2)[0]
	}
	return ""
}

func pnpmCommand(node Tool, vencordDir string) (string, []string) {
	if p := findBinary("pnpm"); p != "" {
		return p, nil
	}
	npx := "npx"
	if node.Path != "" {
		name := "npx"
		if isWindows() {
			name = "npx.cmd"
		}
		if p := filepath.Join(filepath.Dir(node.Path), name); exists(p) {
			npx = p
		}
	}
	spec := "pnpm"
	if v := pnpmVersion(vencordDir); v != "" {
		spec += "@" + v
	}
	return npx, []string{"--yes", spec}
}

func toolPathEnv(tools ...Tool) []string {
	env := os.Environ()
	var dirs []string
	for _, t := range tools {
		if t.Path != "" {
			dirs = append(dirs, filepath.Dir(t.Path))
		}
	}
	if len(dirs) == 0 {
		return env
	}
	key := "PATH"
	for i, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		if strings.EqualFold(k, "PATH") {
			key = k
			env[i] = key + "=" + strings.Join(dirs, string(os.PathListSeparator)) + string(os.PathListSeparator) + v
			return env
		}
	}
	return append(env, key+"="+strings.Join(dirs, string(os.PathListSeparator)))
}
