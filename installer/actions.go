package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
)

const vencordRepo = "https://github.com/Vendicated/Vencord.git"

type Request struct {
	VencordDir     string `json:"vencordDir"`
	DiscordPath    string `json:"discordPath"`
	InstallPrereqs bool   `json:"installPrereqs"`
	RestartDiscord bool   `json:"restartDiscord"`
}

type PlannedStep struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Note  string `json:"note"`
}

type Plan struct {
	Steps      []PlannedStep `json:"steps"`
	Blocker    string        `json:"blocker"`
	VencordDir string        `json:"vencordDir"`
	Downloads  []string      `json:"downloads"`
}

type env struct {
	st      Status
	req     Request
	dir     string
	discord DiscordInstall
	git     Tool
	node    Tool
}

func resolve(st Status, req Request) (*env, string) {
	e := &env{st: st, req: req, git: st.Git, node: st.Node}
	if st.Root {
		return e, "Run this installer as your normal user, not as root or with sudo. It asks for admin rights only if Discord needs them."
	}
	if len(st.Discords) == 0 {
		return e, "Discord desktop wasn't found. Install Discord from discord.com/download, open it once, then click Check again."
	}
	e.discord = st.Discords[0]
	if req.DiscordPath != "" {
		found := false
		for _, d := range st.Discords {
			if samePath(d.Path, req.DiscordPath) {
				e.discord, found = d, true
			}
		}
		if !found {
			return e, "The selected Discord install wasn't found."
		}
	}
	dir := strings.TrimSpace(req.VencordDir)
	if dir == "" {
		dir = st.SuggestedDir
	}
	if !filepath.IsAbs(dir) {
		return e, "The Vencord folder must be a full path."
	}
	e.dir = filepath.Clean(dir)
	if !isVencordCheckout(e.dir) && exists(e.dir) {
		if entries, err := os.ReadDir(e.dir); err != nil || len(entries) > 0 {
			return e, "That folder already exists and isn't a Vencord source folder. Choose an empty or new folder."
		}
	}
	if !st.Git.OK || !st.Node.OK {
		if blocker := prereqBlocker(st, req); blocker != "" {
			return e, blocker
		}
	}
	return e, ""
}

func missingTools(st Status) []string {
	var out []string
	if !st.Git.OK {
		out = append(out, "Git")
	}
	if !st.Node.OK {
		out = append(out, fmt.Sprintf("Node.js %d+", minNodeMajor))
	}
	return out
}

func prereqBlocker(st Status, req Request) string {
	missing := strings.Join(missingTools(st), " and ")
	if st.PackageManager == "" {
		return missing + " must be installed first. " + manualPrereqHelp()
	}
	if !req.InstallPrereqs {
		return missing + " must be installed first. Tick \"Install missing tools\" to do it automatically."
	}
	return ""
}

func manualPrereqHelp() string {
	switch runtime.GOOS {
	case "windows":
		return "Install Git from git-scm.com and Node.js LTS from nodejs.org, then click Check again."
	case "darwin":
		return "Install Homebrew (brew.sh) and click Check again, or install Git (xcode-select --install) and Node.js LTS from nodejs.org."
	default:
		return "Install them with your package manager, e.g. \"sudo apt install git nodejs npm\" or \"sudo dnf install git nodejs\", then click Check again."
	}
}

func (e *env) patcherPath() string {
	return filepath.Join(e.dir, "dist", "patcher.js")
}

func (e *env) alreadyInjected() bool {
	return e.discord.Patched && e.discord.PatcherPath != "" && samePath(e.discord.PatcherPath, e.patcherPath())
}

func planInstall(st Status, req Request) Plan {
	e, blocker := resolve(st, req)
	p := Plan{VencordDir: e.dir, Blocker: blocker}
	if blocker != "" {
		return p
	}
	if !st.Git.OK || !st.Node.OK {
		p.Steps = append(p.Steps, PlannedStep{"prereqs", "Install " + strings.Join(missingTools(st), " and "), "Using " + st.PackageManager})
		p.Downloads = append(p.Downloads, strings.Join(missingTools(st), ", ")+" via "+st.PackageManager)
	}
	if !isVencordCheckout(e.dir) {
		p.Steps = append(p.Steps, PlannedStep{"clone", "Download Vencord source", e.dir})
		p.Downloads = append(p.Downloads, "Vencord source from github.com")
	}
	p.Steps = append(p.Steps,
		PlannedStep{"deps", "Install Vencord dependencies", "pnpm install"},
		PlannedStep{"plugin", "Add PrivacyCleanup " + st.BundledVersion, "src/userplugins/" + pluginFolder},
		PlannedStep{"build", "Build Vencord", "pnpm build"},
	)
	p.Downloads = append(p.Downloads, "Vencord's dependencies from the npm registry")
	if !e.alreadyInjected() {
		note := "Discord " + e.discord.Branch
		if e.discord.Kind == "official" {
			note += " (replaces the standard Vencord install)"
		}
		p.Steps = append(p.Steps, PlannedStep{"inject", "Add Vencord to Discord", note})
		p.Downloads = append(p.Downloads, "Vencord's official installer from github.com")
	}
	if !pluginEnabled(vencordSettingsFile(e.discord)) {
		p.Steps = append(p.Steps, PlannedStep{"enable", "Turn on PrivacyCleanup", "Vencord settings"})
	}
	if req.RestartDiscord {
		p.Steps = append(p.Steps, PlannedStep{"restart", "Restart Discord", ""})
	}
	return p
}

func (e *env) toolEnv() []string {
	return toolPathEnv(e.git, e.node)
}

func (e *env) pnpm(ctx context.Context, j *Job, args ...string) error {
	name, prefix := pnpmCommand(e.node, e.dir)
	return j.run(ctx, e.dir, e.toolEnv(), name, append(prefix, args...)...)
}

func (e *env) stepPrereqs(j *Job) stepFunc {
	return stepFunc{"prereqs", "Install " + strings.Join(missingTools(e.st), " and "), func(ctx context.Context) error {
		switch e.st.PackageManager {
		case "winget":
			ids := map[string]string{}
			if !e.st.Git.OK {
				ids["Git"] = "Git.Git"
			}
			if !e.st.Node.OK {
				ids["Node.js"] = "OpenJS.NodeJS.LTS"
			}
			for name, id := range ids {
				j.logf("info", "Installing %s. Windows may ask for permission.", name)
				if err := j.run(ctx, "", os.Environ(), wingetPath(), "install", "--id", id, "-e", "--source", "winget",
					"--accept-package-agreements", "--accept-source-agreements", "--silent"); err != nil {
					j.logf("info", "winget reported a problem; checking whether %s is available anyway.", name)
				}
			}
		case "brew":
			var pkgs []string
			if !e.st.Git.OK {
				pkgs = append(pkgs, "git")
			}
			if !e.st.Node.OK {
				pkgs = append(pkgs, "node")
			}
			if err := j.run(ctx, "", os.Environ(), findBinary("brew"), append([]string{"install"}, pkgs...)...); err != nil {
				return err
			}
		default:
			return errors.New(manualPrereqHelp())
		}
		e.git, e.node = detectGit(), detectNode()
		if !e.git.OK || !e.node.OK {
			return errors.New("the tools were installed but can't be found yet. Close and reopen this installer, then try again")
		}
		j.logf("ok", "Git %s and Node.js %s are ready", e.git.Version, e.node.Version)
		return nil
	}}
}

func (e *env) stepClone(j *Job) stepFunc {
	return stepFunc{"clone", "Download Vencord source", func(ctx context.Context) error {
		if err := os.MkdirAll(filepath.Dir(e.dir), 0o755); err != nil {
			return err
		}
		if err := j.run(ctx, filepath.Dir(e.dir), e.toolEnv(), e.git.Path, "clone", "--depth", "1", vencordRepo, e.dir); err != nil {
			return err
		}
		if !isVencordCheckout(e.dir) {
			return errors.New("the download didn't produce a Vencord source folder")
		}
		return nil
	}}
}

func (e *env) stepDeps(j *Job) stepFunc {
	return stepFunc{"deps", "Install Vencord dependencies", func(ctx context.Context) error {
		return e.pnpm(ctx, j, "install", "--frozen-lockfile")
	}}
}

func (e *env) stepPlugin(j *Job) stepFunc {
	return stepFunc{"plugin", "Add PrivacyCleanup " + e.st.BundledVersion, func(context.Context) error {
		if err := writePlugin(e.dir); err != nil {
			return err
		}
		j.logf("info", "Plugin written to %s", pluginDir(e.dir))
		return nil
	}}
}

func (e *env) stepBuild(j *Job) stepFunc {
	return stepFunc{"build", "Build Vencord", func(ctx context.Context) error {
		if err := e.pnpm(ctx, j, "build"); err != nil {
			return err
		}
		if !exists(e.patcherPath()) {
			return errors.New("the build finished but dist/patcher.js is missing")
		}
		return nil
	}}
}

func (e *env) runVencordInstaller(ctx context.Context, j *Job, flag string) error {
	args := []string{filepath.Join("scripts", "runInstaller.mjs"), "--", flag, "--location", e.discord.Path}
	if runtime.GOOS == "linux" && !e.discord.Writable {
		pkexec := findBinary("pkexec")
		if pkexec == "" {
			return fmt.Errorf("Discord is installed system-wide and needs admin rights. Run this in a terminal:\n  cd %q && sudo node scripts/runInstaller.mjs -- %s --location %q", e.dir, flag, e.discord.Path)
		}
		u, _ := user.Current()
		j.logf("info", "Discord is installed system-wide; asking for admin rights.")
		script := `cd "$1" && env SUDO_USER="$2" PATH="$3" "$4" scripts/runInstaller.mjs -- "$5" --location "$6"; s=$?; chown -R "$2" dist/Installer 2>/dev/null; exit $s`
		return j.run(ctx, e.dir, e.toolEnv(), pkexec, "sh", "-c", script, "sh", e.dir, u.Username, envValue(e.toolEnv(), "PATH"), e.node.Path, flag, e.discord.Path)
	}
	return j.run(ctx, e.dir, e.toolEnv(), e.node.Path, args...)
}

func envValue(env []string, key string) string {
	for _, kv := range env {
		if k, v, ok := strings.Cut(kv, "="); ok && strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

func (e *env) reinspect() {
	inspectResources(&e.discord)
}

func (e *env) stepInject(j *Job) stepFunc {
	return stepFunc{"inject", "Add Vencord to Discord", func(ctx context.Context) error {
		closeDiscord(e.discord)
		if err := e.runVencordInstaller(ctx, j, "--install"); err != nil {
			return err
		}
		e.reinspect()
		if !e.alreadyInjected() {
			if runtime.GOOS == "darwin" {
				return errors.New("Vencord's installer didn't finish patching Discord. If macOS blocked it, allow this installer under System Settings → Privacy & Security → App Management, then try again")
			}
			return errors.New("Vencord's installer didn't finish patching Discord. Check the log above")
		}
		j.logf("ok", "Discord now loads Vencord from %s", e.dir)
		return nil
	}}
}

func (e *env) stepEnable(j *Job) stepFunc {
	return stepFunc{"enable", "Turn on PrivacyCleanup", func(context.Context) error {
		if e.req.RestartDiscord {
			closeDiscord(e.discord)
		}
		file := vencordSettingsFile(e.discord)
		if err := enablePlugin(file); err != nil {
			return fmt.Errorf("couldn't update %s: %w", file, err)
		}
		j.logf("info", "Enabled in %s", file)
		return nil
	}}
}

func (e *env) stepRestart(j *Job) stepFunc {
	return stepFunc{"restart", "Restart Discord", func(context.Context) error {
		closeDiscord(e.discord)
		if err := launchDiscord(e.discord); err != nil {
			j.logf("info", "Couldn't reopen Discord automatically (%s). Open it yourself.", err)
		}
		return nil
	}}
}

func installSteps(st Status, req Request, j *Job) ([]stepFunc, error) {
	plan := planInstall(st, req)
	if plan.Blocker != "" {
		return nil, errors.New(plan.Blocker)
	}
	e, _ := resolve(st, req)
	var steps []stepFunc
	for _, p := range plan.Steps {
		switch p.ID {
		case "prereqs":
			steps = append(steps, e.stepPrereqs(j))
		case "clone":
			steps = append(steps, e.stepClone(j))
		case "deps":
			steps = append(steps, e.stepDeps(j))
		case "plugin":
			steps = append(steps, e.stepPlugin(j))
		case "build":
			steps = append(steps, e.stepBuild(j))
		case "inject":
			steps = append(steps, e.stepInject(j))
		case "enable":
			steps = append(steps, e.stepEnable(j))
		case "restart":
			steps = append(steps, e.stepRestart(j))
		}
	}
	return steps, nil
}

func requireCheckout(st Status, req Request) (*env, error) {
	e, blocker := resolve(st, req)
	if blocker != "" && !strings.Contains(blocker, "must be installed") {
		return nil, errors.New(blocker)
	}
	if !isVencordCheckout(e.dir) {
		return nil, errors.New("no Vencord source folder at " + e.dir)
	}
	if !st.Node.OK {
		return nil, errors.New("Node.js is required")
	}
	return e, nil
}

func removePluginSteps(st Status, req Request, j *Job) ([]stepFunc, error) {
	e, err := requireCheckout(st, req)
	if err != nil {
		return nil, err
	}
	steps := []stepFunc{
		{"remove", "Remove PrivacyCleanup", func(context.Context) error { return removePlugin(e.dir) }},
		e.stepBuild(j),
	}
	if req.RestartDiscord {
		steps = append(steps, e.stepRestart(j))
	}
	return steps, nil
}

func updateVencordSteps(st Status, req Request, j *Job) ([]stepFunc, error) {
	e, err := requireCheckout(st, req)
	if err != nil {
		return nil, err
	}
	if !st.Git.OK {
		return nil, errors.New("Git is required")
	}
	steps := []stepFunc{
		{"pull", "Update Vencord source", func(ctx context.Context) error {
			return j.run(ctx, e.dir, e.toolEnv(), e.git.Path, "pull", "--ff-only")
		}},
		e.stepDeps(j),
	}
	if installedPluginVersion(e.dir) != "" {
		steps = append(steps, e.stepPlugin(j))
	}
	steps = append(steps, e.stepBuild(j))
	if req.RestartDiscord {
		steps = append(steps, e.stepRestart(j))
	}
	return steps, nil
}

func removeVencordSteps(st Status, req Request, j *Job) ([]stepFunc, error) {
	e, err := requireCheckout(st, req)
	if err != nil {
		return nil, err
	}
	steps := []stepFunc{{"uninject", "Remove Vencord from Discord", func(ctx context.Context) error {
		closeDiscord(e.discord)
		if err := e.runVencordInstaller(ctx, j, "--uninstall"); err != nil {
			return err
		}
		e.reinspect()
		if e.discord.Patched {
			return errors.New("Discord still appears patched. Check the log above")
		}
		return nil
	}}}
	if req.RestartDiscord {
		steps = append(steps, e.stepRestart(j))
	}
	return steps, nil
}
