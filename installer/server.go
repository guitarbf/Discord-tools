package main

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var webFS embed.FS

type server struct {
	token    string
	host     string
	job      Job
	mu       sync.Mutex
	lastPing time.Time
	quit     chan struct{}
	quitOnce sync.Once
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func newServer() *server {
	return &server{token: randomHex(32), quit: make(chan struct{})}
}

func (s *server) listen() (net.Listener, string, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}
	s.host = ln.Addr().String()
	return ln, "http://" + s.host + "/?t=" + s.token, nil
}

func (s *server) tokenOK(got string) bool {
	return subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) == 1
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.index)
	mux.HandleFunc("/api/status", s.api(s.status))
	mux.HandleFunc("/api/plan", s.api(s.plan))
	mux.HandleFunc("/api/run", s.api(s.runAction))
	mux.HandleFunc("/api/job", s.api(s.jobState))
	mux.HandleFunc("/api/cancel", s.api(s.cancel))
	mux.HandleFunc("/api/ping", s.api(s.ping))
	mux.HandleFunc("/api/quit", s.api(s.quitHandler))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reject DNS-rebinding and foreign origins.
		if r.Host != s.host {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}

func (s *server) index(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" || !s.tokenOK(r.URL.Query().Get("t")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	page, _ := webFS.ReadFile("web/index.html")
	nonceBytes := make([]byte, 16)
	_, _ = rand.Read(nonceBytes)
	nonce := base64.StdEncoding.EncodeToString(nonceBytes)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(strings.ReplaceAll(string(page), "{{NONCE}}", nonce)))
}

func (s *server) api(fn func(*http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !s.tokenOK(r.Header.Get("X-Token")) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		s.touch()
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
		res, err := fn(r)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(res)
	}
}

func decode[T any](r *http.Request) (T, error) {
	var v T
	if r.ContentLength == 0 {
		return v, nil
	}
	err := json.NewDecoder(r.Body).Decode(&v)
	return v, err
}

func (s *server) touch() {
	s.mu.Lock()
	s.lastPing = time.Now()
	s.mu.Unlock()
}

func (s *server) status(*http.Request) (any, error) {
	return detect(), nil
}

func (s *server) plan(r *http.Request) (any, error) {
	req, err := decode[Request](r)
	if err != nil {
		return nil, err
	}
	return planInstall(detect(), req), nil
}

type runRequest struct {
	Action string `json:"action"`
	Request
}

func (s *server) runAction(r *http.Request) (any, error) {
	rr, err := decode[runRequest](r)
	if err != nil {
		return nil, err
	}
	st := detect()
	var steps []stepFunc
	switch rr.Action {
	case "install":
		steps, err = installSteps(st, rr.Request, &s.job)
	case "removePlugin":
		steps, err = removePluginSteps(st, rr.Request, &s.job)
	case "updateVencord":
		steps, err = updateVencordSteps(st, rr.Request, &s.job)
	case "removeVencord":
		steps, err = removeVencordSteps(st, rr.Request, &s.job)
	default:
		return nil, errors.New("unknown action")
	}
	if err != nil {
		return nil, err
	}
	return map[string]bool{"started": true}, s.job.Start(rr.Action, steps)
}

func (s *server) jobState(*http.Request) (any, error) {
	return s.job.Snapshot(), nil
}

func (s *server) cancel(*http.Request) (any, error) {
	s.job.Cancel()
	return map[string]bool{"ok": true}, nil
}

func (s *server) ping(*http.Request) (any, error) {
	return map[string]bool{"ok": true}, nil
}

func (s *server) quitHandler(*http.Request) (any, error) {
	if s.job.Running() {
		return nil, errors.New("wait for the current task to finish")
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.shutdown()
	}()
	return map[string]bool{"ok": true}, nil
}

func (s *server) shutdown() {
	s.quitOnce.Do(func() { close(s.quit) })
}

func (s *server) watchdog(startupGrace, idle time.Duration) {
	start := time.Now()
	for {
		select {
		case <-s.quit:
			return
		case <-time.After(time.Second):
		}
		s.mu.Lock()
		last := s.lastPing
		s.mu.Unlock()
		if s.job.Running() {
			continue
		}
		if last.IsZero() && time.Since(start) > startupGrace || !last.IsZero() && time.Since(last) > idle {
			s.shutdown()
			return
		}
	}
}
