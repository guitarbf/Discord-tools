package main

import (
	"syscall"
	"unsafe"
)

func showError(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	text, _ := syscall.UTF16PtrFromString(msg)
	title, _ := syscall.UTF16PtrFromString("PrivacyCleanup Installer")
	_, _, _ = box.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}
