//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func isWindows() bool { return false }

func hideWindow(*exec.Cmd) {}

func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
