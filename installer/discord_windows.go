package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var windowsBranches = []struct{ dir, branch, exe string }{
	{"Discord", "stable", "Discord.exe"},
	{"DiscordPTB", "ptb", "DiscordPTB.exe"},
	{"DiscordCanary", "canary", "DiscordCanary.exe"},
}

func discordCandidates() []DiscordInstall {
	var out []DiscordInstall
	local := os.Getenv("LOCALAPPDATA")
	for _, b := range windowsBranches {
		base := filepath.Join(local, b.dir)
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		resources := ""
		for _, e := range entries {
			if e.IsDir() && strings.HasPrefix(e.Name(), "app-") {
				r := filepath.Join(base, e.Name(), "resources")
				if exists(r) && r > resources {
					resources = r
				}
			}
		}
		if resources != "" {
			out = append(out, DiscordInstall{Branch: b.branch, Path: base, Resources: resources})
		}
	}
	return out
}

func exeFor(d DiscordInstall) string {
	for _, b := range windowsBranches {
		if b.branch == d.Branch {
			return b.exe
		}
	}
	return "Discord.exe"
}

func closeDiscord(d DiscordInstall) {
	cmd := exec.Command("taskkill", "/F", "/IM", exeFor(d))
	hideWindow(cmd)
	_ = cmd.Run()
	time.Sleep(2 * time.Second)
}

func launchDiscord(d DiscordInstall) error {
	cmd := exec.Command(filepath.Join(d.Path, "Update.exe"), "--processStart", exeFor(d))
	hideWindow(cmd)
	return cmd.Start()
}
