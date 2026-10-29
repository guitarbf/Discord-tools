package main

import (
	"os"
	"path/filepath"
	"runtime"
)

type Checkout struct {
	Path          string `json:"path"`
	Built         bool   `json:"built"`
	PluginVersion string `json:"pluginVersion"`
}

type Status struct {
	OS             string           `json:"os"`
	BundledVersion string           `json:"bundledVersion"`
	Git            Tool             `json:"git"`
	Node           Tool             `json:"node"`
	PackageManager string           `json:"packageManager"`
	Discords       []DiscordInstall `json:"discords"`
	Checkouts      []Checkout       `json:"checkouts"`
	SuggestedDir   string           `json:"suggestedDir"`
	Root           bool             `json:"root"`
}

func checkoutCandidates() []string {
	home, _ := os.UserHomeDir()
	var out []string
	for _, parent := range []string{home, filepath.Join(home, "Documents"), filepath.Join(home, "Desktop"), filepath.Join(home, "Downloads"),
		filepath.Join(home, "source", "repos"), filepath.Join(home, "Projects"), filepath.Join(home, "projects"), filepath.Join(home, "dev"),
		filepath.Join(home, "git"), filepath.Join(home, "GitHub"), filepath.Join(home, "Documents", "GitHub"), filepath.Join(home, "code")} {
		for _, name := range []string{"Vencord", "vencord", "Vencord-PrivacyCleanup"} {
			out = append(out, filepath.Join(parent, name))
		}
	}
	return out
}

func describeCheckout(dir string) Checkout {
	return Checkout{
		Path:          dir,
		Built:         exists(filepath.Join(dir, "dist", "patcher.js")),
		PluginVersion: installedPluginVersion(dir),
	}
}

func suggestedDir(home string) string {
	for _, name := range []string{"Vencord", "Vencord-PrivacyCleanup"} {
		p := filepath.Join(home, name)
		if !exists(p) || isVencordCheckout(p) {
			return p
		}
	}
	return filepath.Join(home, "Vencord-PrivacyCleanup-2")
}

func detect() Status {
	home, _ := os.UserHomeDir()
	st := Status{
		OS:             runtime.GOOS,
		BundledVersion: bundledVersion(),
		Git:            detectGit(),
		Node:           detectNode(),
		PackageManager: packageManager(),
		Discords:       findDiscords(),
		Root:           runningAsRoot(),
	}
	var dirs []string
	for _, d := range st.Discords {
		if d.VencordDir != "" {
			dirs = append(dirs, d.VencordDir)
		}
	}
	dirs = append(dirs, checkoutCandidates()...)
	for _, dir := range dirs {
		if !isVencordCheckout(dir) {
			continue
		}
		dup := false
		for _, c := range st.Checkouts {
			if samePath(c.Path, dir) {
				dup = true
				break
			}
		}
		if !dup {
			st.Checkouts = append(st.Checkouts, describeCheckout(dir))
		}
	}
	if len(st.Checkouts) > 0 {
		st.SuggestedDir = st.Checkouts[0].Path
	} else {
		st.SuggestedDir = suggestedDir(home)
	}
	return st
}
