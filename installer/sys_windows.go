package main

import (
	"os/exec"
	"syscall"
)

func isWindows() bool { return true }

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func detach(cmd *exec.Cmd) { hideWindow(cmd) }
