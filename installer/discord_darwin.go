package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func discordCandidates() []DiscordInstall {
	var out []DiscordInstall
	home, _ := os.UserHomeDir()
	for _, base := range []string{"/Applications", filepath.Join(home, "Applications")} {
		for _, app := range []struct{ name, branch string }{{"Discord.app", "stable"}, {"Discord PTB.app", "ptb"}, {"Discord Canary.app", "canary"}} {
			p := filepath.Join(base, app.name)
			r := filepath.Join(p, "Contents", "Resources")
			if exists(filepath.Join(r, "app.asar")) || exists(filepath.Join(r, "_app.asar")) {
				out = append(out, DiscordInstall{Branch: app.branch, Path: p, Resources: r})
			}
		}
	}
	return out
}

func closeDiscord(d DiscordInstall) {
	name := strings.TrimSuffix(filepath.Base(d.Path), ".app")
	_ = exec.Command("osascript", "-e", `quit app "`+name+`"`).Run()
	time.Sleep(2 * time.Second)
}

func launchDiscord(d DiscordInstall) error {
	return exec.Command("open", d.Path).Start()
}
