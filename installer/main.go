package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	noOpen := flag.Bool("no-open", false, "Print the URL instead of opening a window")
	cli := flag.Bool("cli", false, "Text mode")
	flag.Parse()

	if *cli {
		os.Exit(runCLI())
	}

	s := newServer()
	ln, url, err := s.listen()
	if err != nil {
		fatal("Couldn't start the installer: " + err.Error())
	}
	srv := &http.Server{Handler: s.handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()

	fmt.Println("PrivacyCleanup installer running at", url)
	if *noOpen {
		go s.watchdog(24*time.Hour, 24*time.Hour)
	} else {
		if err := openWindow(url); err != nil {
			fmt.Println("Open this address in your browser:", url)
		}
		go s.watchdog(3*time.Minute, 20*time.Second)
	}
	<-s.quit
	_ = srv.Close()
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	showError(msg)
	os.Exit(1)
}
