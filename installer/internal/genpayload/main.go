package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

func main() {
	root, _ := filepath.Abs("..")
	out := "payload"
	must(os.RemoveAll(out))
	for _, entry := range []string{"index.tsx", "style.css", "src"} {
		must(copyTree(filepath.Join(root, entry), filepath.Join(out, "plugin", entry)))
	}
	var pkg struct{ Version string }
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	must(err)
	must(json.Unmarshal(data, &pkg))
	must(os.WriteFile(filepath.Join(out, "VERSION"), []byte(pkg.Version), 0o644))
	fmt.Println("payload generated, version", pkg.Version)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
