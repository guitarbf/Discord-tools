package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

var linuxNames = []struct{ dir, branch, bin string }{
	{"discord", "stable", "Discord"},
	{"Discord", "stable", "Discord"},
	{"discord-ptb", "ptb", "DiscordPTB"},
	{"DiscordPTB", "ptb", "DiscordPTB"},
	{"discord-canary", "canary", "DiscordCanary"},
	{"DiscordCanary", "canary", "DiscordCanary"},
}

var flatpakNames = []struct{ id, branch, sub string }{
	{"com.discordapp.Discord", "stable", "discord"},
	{"com.discordapp.DiscordPTB", "ptb", "discord-ptb"},
	{"com.discordapp.DiscordCanary", "canary", "discord-canary"},
}

func discordCandidates() []DiscordInstall {
	var out []DiscordInstall
	seen := map[string]bool{}
	home, _ := os.UserHomeDir()
	for _, base := range []string{"/usr/share", "/usr/lib64", "/usr/lib", "/opt", filepath.Join(home, ".local/share")} {
		for _, n := range linuxNames {
			p := filepath.Join(base, n.dir)
			r := filepath.Join(p, "resources")
			real, _ := filepath.EvalSymlinks(p)
			if seen[real] || !exists(filepath.Join(r, "app.asar")) && !exists(filepath.Join(r, "_app.asar")) {
				continue
			}
			seen[real] = true
			out = append(out, DiscordInstall{Branch: n.branch, Path: p, Resources: r})
		}
	}
	for _, base := range []string{"/var/lib/flatpak/app", filepath.Join(home, ".local/share/flatpak/app")} {
		for _, f := range flatpakNames {
			p := filepath.Join(base, f.id)
			r := filepath.Join(p, "current", "active", "files", f.sub, "resources")
			if exists(filepath.Join(r, "app.asar")) || exists(filepath.Join(r, "_app.asar")) {
				out = append(out, DiscordInstall{Branch: f.branch, Path: p, Resources: r, Flatpak: true})
			}
		}
	}
	return out
}

func binFor(d DiscordInstall) string {
	for _, n := range linuxNames {
		if n.branch == d.Branch {
			if p := filepath.Join(d.Path, n.bin); exists(p) {
				return p
			}
		}
	}
	return ""
}

func closeDiscord(d DiscordInstall) {
	if d.Flatpak {
		_ = exec.Command("flatpak", "kill", flatpakIDOf(d.Path)).Run()
	} else {
		for _, n := range []string{"Discord", "DiscordPTB", "DiscordCanary"} {
			_ = exec.Command("pkill", "-x", n).Run()
		}
	}
	time.Sleep(2 * time.Second)
}

func launchDiscord(d DiscordInstall) error {
	var cmd *exec.Cmd
	if d.Flatpak {
		cmd = exec.Command("flatpak", "run", flatpakIDOf(d.Path))
	} else if bin := binFor(d); bin != "" {
		cmd = exec.Command(bin)
	} else {
		cmd = exec.Command("discord")
	}
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
