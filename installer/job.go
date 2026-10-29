package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type LogLine struct {
	At   int64  `json:"at"`
	Text string `json:"text"`
	Kind string `json:"kind"`
}

type StepState struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type JobSnapshot struct {
	Running  bool        `json:"running"`
	Action   string      `json:"action"`
	Steps    []StepState `json:"steps"`
	Log      []LogLine   `json:"log"`
	Error    string      `json:"error"`
	Done     bool        `json:"done"`
	Finished int64       `json:"finished"`
}

type Job struct {
	mu     sync.Mutex
	snap   JobSnapshot
	cancel context.CancelFunc
}

const maxLogLines = 2000

func (j *Job) Snapshot() JobSnapshot {
	j.mu.Lock()
	defer j.mu.Unlock()
	s := j.snap
	s.Steps = append([]StepState(nil), j.snap.Steps...)
	s.Log = append([]LogLine(nil), j.snap.Log...)
	return s
}

func (j *Job) Running() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.snap.Running
}

func (j *Job) logf(kind, format string, args ...any) {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, line := range strings.Split(strings.TrimRight(fmt.Sprintf(format, args...), "\n"), "\n") {
		j.snap.Log = append(j.snap.Log, LogLine{At: time.Now().UnixMilli(), Text: stripANSI(line), Kind: kind})
	}
	if over := len(j.snap.Log) - maxLogLines; over > 0 {
		j.snap.Log = j.snap.Log[over:]
	}
}

func (j *Job) setStep(id, status string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	for i := range j.snap.Steps {
		if j.snap.Steps[i].ID == id {
			j.snap.Steps[i].Status = status
		}
	}
}

type stepFunc struct {
	id, title string
	run       func(ctx context.Context) error
}

var errBusy = errors.New("another task is already running")

func (j *Job) Start(action string, steps []stepFunc) error {
	j.mu.Lock()
	if j.snap.Running {
		j.mu.Unlock()
		return errBusy
	}
	ctx, cancel := context.WithCancel(context.Background())
	j.cancel = cancel
	j.snap = JobSnapshot{Running: true, Action: action}
	for _, s := range steps {
		j.snap.Steps = append(j.snap.Steps, StepState{ID: s.id, Title: s.title, Status: "pending"})
	}
	j.mu.Unlock()

	go func() {
		var failed error
		for _, s := range steps {
			if ctx.Err() != nil {
				failed = errors.New("cancelled")
				break
			}
			j.setStep(s.id, "running")
			j.logf("step", "▶ %s", s.title)
			if err := s.run(ctx); err != nil {
				j.setStep(s.id, "failed")
				j.logf("error", "✖ %s", err)
				failed = err
				break
			}
			j.setStep(s.id, "done")
		}
		j.mu.Lock()
		j.snap.Running = false
		j.snap.Done = failed == nil
		j.snap.Finished = time.Now().UnixMilli()
		if failed != nil {
			j.snap.Error = failed.Error()
			for i := range j.snap.Steps {
				if j.snap.Steps[i].Status == "pending" {
					j.snap.Steps[i].Status = "skipped"
				}
			}
		}
		j.mu.Unlock()
		if failed == nil {
			j.logf("ok", "✔ Done")
		}
	}()
	return nil
}

func (j *Job) Cancel() {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.cancel != nil {
		j.cancel()
	}
}

func (j *Job) run(ctx context.Context, dir string, env []string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = append(env, "CI=1", "FORCE_COLOR=0", "NO_COLOR=1", "npm_config_yes=true")
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	j.logf("cmd", "$ %s %s", displayName(name), strings.Join(args, " "))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("couldn't start %s: %w", displayName(name), err)
	}
	pump(stdout, func(line string) { j.logf("out", "%s", line) })
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return errors.New("cancelled")
		}
		return fmt.Errorf("%s failed: %w", displayName(name), err)
	}
	return nil
}

func displayName(p string) string {
	parts := strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return p
	}
	return parts[len(parts)-1]
}

func pump(r io.Reader, fn func(string)) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	sc.Split(scanLinesCR)
	for sc.Scan() {
		if t := strings.TrimSpace(sc.Text()); t != "" {
			fn(t)
		}
	}
}

func scanLinesCR(data []byte, atEOF bool) (int, []byte, error) {
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func stripANSI(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '[' {
			i += 2
			for i < len(s) && (s[i] < 0x40 || s[i] > 0x7e) {
				i++
			}
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
