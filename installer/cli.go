package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"
)

func ask(r *bufio.Reader, q string) bool {
	fmt.Print(q + " [y/N] ")
	line, _ := r.ReadString('\n')
	return strings.EqualFold(strings.TrimSpace(line), "y")
}

func runCLI() int {
	in := bufio.NewReader(os.Stdin)
	st := detect()
	fmt.Printf("PrivacyCleanup installer %s\n\n", st.BundledVersion)
	printTool(st.Git)
	printTool(st.Node)
	if len(st.Discords) == 0 {
		fmt.Println("Discord:  not found")
	}
	for _, d := range st.Discords {
		fmt.Printf("Discord:  %s at %s (%s)\n", d.Branch, d.Path, vencordLabel(d))
	}
	for _, c := range st.Checkouts {
		v := c.PluginVersion
		if v == "" {
			v = "not installed"
		}
		fmt.Printf("Vencord source: %s (plugin: %s)\n", c.Path, v)
	}
	fmt.Println()

	req := Request{VencordDir: st.SuggestedDir, RestartDiscord: true}
	if !st.Git.OK || !st.Node.OK {
		req.InstallPrereqs = st.PackageManager != "" && ask(in, "Install "+strings.Join(missingTools(st), " and ")+" with "+st.PackageManager+"?")
	}
	plan := planInstall(st, req)
	if plan.Blocker != "" {
		fmt.Println(plan.Blocker)
		return 1
	}
	fmt.Println("Plan:")
	for i, s := range plan.Steps {
		fmt.Printf("  %d. %s  %s\n", i+1, s.Title, s.Note)
	}
	fmt.Println("Downloads: " + strings.Join(plan.Downloads, "; "))
	if !ask(in, "\nDiscord will be closed and reopened. Continue?") {
		return 1
	}

	var job Job
	steps, err := installSteps(st, req, &job)
	if err == nil {
		err = job.Start("install", steps)
	}
	if err != nil {
		fmt.Println(err)
		return 1
	}
	printed := 0
	for {
		snap := job.Snapshot()
		for _, l := range snap.Log[min(printed, len(snap.Log)):] {
			fmt.Println(l.Text)
		}
		printed = len(snap.Log)
		if !snap.Running {
			if snap.Done {
				return 0
			}
			return 1
		}
		time.Sleep(300 * time.Millisecond)
	}
}

func printTool(t Tool) {
	switch {
	case t.OK:
		fmt.Printf("%-9s %s\n", t.Name+":", t.Version)
	case t.Found:
		fmt.Printf("%-9s %s (%s)\n", t.Name+":", t.Version, t.Note)
	default:
		fmt.Printf("%-9s missing\n", t.Name+":")
	}
}

func vencordLabel(d DiscordInstall) string {
	switch d.Kind {
	case "source":
		return "Vencord from " + d.VencordDir
	case "official":
		return "standard Vencord"
	case "other":
		return "modified by another client mod"
	default:
		return "no Vencord"
	}
}
