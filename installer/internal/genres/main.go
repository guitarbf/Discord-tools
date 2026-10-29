package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf16"
)

const (
	rtIcon      = 3
	rtVersion   = 16
	rtGroupIcon = 14
	rtManifest  = 24
	langUS      = 0x0409
)

var sizes = []int{256, 128, 64, 48, 32, 24, 16}

const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="PrivacyCleanup.Installer" version="%s.0"/>
  <description>PrivacyCleanup Installer</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
`

type resource struct {
	typ, id, lang uint32
	data          []byte
}

func main() {
	version := strings.TrimSpace(readFile("payload/VERSION"))
	parts := strings.Split(version+".0.0", ".")[:3]
	var res []resource
	var group bytes.Buffer
	le(&group, uint16(0), uint16(1), uint16(len(sizes)))
	for i, size := range sizes {
		png := []byte(readFile(filepath.Join("assets", fmt.Sprintf("icon-%d.png", size))))
		res = append(res, resource{rtIcon, uint32(i + 1), langUS, png})
		dim := uint8(size)
		if size == 256 {
			dim = 0
		}
		le(&group, dim, dim, uint8(0), uint8(0), uint16(1), uint16(32), uint32(len(png)), uint16(i+1))
	}
	res = append(res,
		resource{rtGroupIcon, 1, langUS, group.Bytes()},
		resource{rtVersion, 1, langUS, versionInfo(version, parts)},
		resource{rtManifest, 1, langUS, []byte(fmt.Sprintf(manifest, strings.Join(parts, ".")))},
	)
	for _, arch := range []struct {
		name    string
		machine uint16
		reloc   uint16
	}{{"amd64", 0x8664, 3}, {"arm64", 0xAA64, 2}} {
		out := fmt.Sprintf("rsrc_windows_%s.syso", arch.name)
		if err := os.WriteFile(out, coff(res, arch.machine, arch.reloc), 0o644); err != nil {
			panic(err)
		}
		fmt.Println("wrote", out)
	}
}

func readFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func le(b *bytes.Buffer, vals ...any) {
	for _, v := range vals {
		_ = binary.Write(b, binary.LittleEndian, v)
	}
}

func pad4(b *bytes.Buffer) {
	for b.Len()%4 != 0 {
		b.WriteByte(0)
	}
}

func utf16z(s string) []byte {
	var b bytes.Buffer
	for _, r := range utf16.Encode([]rune(s)) {
		le(&b, r)
	}
	le(&b, uint16(0))
	return b.Bytes()
}

func block(key string, valueLen uint16, typ uint16, value []byte, children ...[]byte) []byte {
	var b bytes.Buffer
	le(&b, uint16(0), valueLen, typ)
	b.Write(utf16z(key))
	pad4(&b)
	b.Write(value)
	for _, c := range children {
		pad4(&b)
		b.Write(c)
	}
	out := b.Bytes()
	binary.LittleEndian.PutUint16(out, uint16(len(out)))
	return out
}

func versionInfo(version string, parts []string) []byte {
	var n [4]uint16
	for i, p := range parts {
		fmt.Sscan(p, &n[i])
	}
	var fixed bytes.Buffer
	le(&fixed, uint32(0xFEEF04BD), uint32(0x00010000),
		uint32(n[0])<<16|uint32(n[1]), uint32(n[2])<<16|uint32(n[3]),
		uint32(n[0])<<16|uint32(n[1]), uint32(n[2])<<16|uint32(n[3]),
		uint32(0x3F), uint32(0), uint32(0x40004), uint32(1), uint32(0), uint32(0), uint32(0))
	strs := [][2]string{
		{"CompanyName", "guitarbf"},
		{"FileDescription", "PrivacyCleanup Installer"},
		{"FileVersion", version},
		{"InternalName", "PrivacyCleanupInstaller"},
		{"OriginalFilename", "PrivacyCleanupInstaller.exe"},
		{"ProductName", "PrivacyCleanup"},
		{"ProductVersion", version},
	}
	var items [][]byte
	for _, kv := range strs {
		v := utf16z(kv[1])
		items = append(items, block(kv[0], uint16(len(v)/2), 1, v))
	}
	table := block("040904b0", 0, 1, nil, items...)
	sfi := block("StringFileInfo", 0, 1, nil, table)
	var tr bytes.Buffer
	le(&tr, uint16(langUS), uint16(1200))
	vfi := block("VarFileInfo", 0, 1, nil, block("Translation", 4, 0, tr.Bytes()))
	return block("VS_VERSION_INFO", uint16(fixed.Len()), 0, fixed.Bytes(), sfi, vfi)
}

func coff(res []resource, machine, relocType uint16) []byte {
	sort.Slice(res, func(i, j int) bool {
		if res[i].typ != res[j].typ {
			return res[i].typ < res[j].typ
		}
		return res[i].id < res[j].id
	})
	var types []uint32
	byType := map[uint32][]int{}
	for i, r := range res {
		if len(byType[r.typ]) == 0 {
			types = append(types, r.typ)
		}
		byType[r.typ] = append(byType[r.typ], i)
	}

	dirSize := func(n int) int { return 16 + 8*n }
	offset := dirSize(len(types))
	typeDir := map[uint32]int{}
	for _, t := range types {
		typeDir[t] = offset
		offset += dirSize(len(byType[t]))
	}
	nameDir := make([]int, len(res))
	for i := range res {
		nameDir[i] = offset
		offset += dirSize(1)
	}
	dataEntry := make([]int, len(res))
	for i := range res {
		dataEntry[i] = offset
		offset += 16
	}
	dataAt := make([]int, len(res))
	for i, r := range res {
		offset = (offset + 7) &^ 7
		dataAt[i] = offset
		offset += len(r.data)
	}
	size := (offset + 7) &^ 7

	sec := make([]byte, size)
	dir := func(at, entries int) int {
		binary.LittleEndian.PutUint16(sec[at+14:], uint16(entries))
		return at + 16
	}
	entry := func(at int, id uint32, target int, subdir bool) {
		binary.LittleEndian.PutUint32(sec[at:], id)
		v := uint32(target)
		if subdir {
			v |= 0x80000000
		}
		binary.LittleEndian.PutUint32(sec[at+4:], v)
	}
	at := dir(0, len(types))
	for _, t := range types {
		entry(at, t, typeDir[t], true)
		at += 8
		sub := dir(typeDir[t], len(byType[t]))
		for _, i := range byType[t] {
			entry(sub, res[i].id, nameDir[i], true)
			sub += 8
		}
	}
	var relocs []uint32
	for i, r := range res {
		entry(dir(nameDir[i], 1), r.lang, dataEntry[i], false)
		binary.LittleEndian.PutUint32(sec[dataEntry[i]:], uint32(dataAt[i]))
		binary.LittleEndian.PutUint32(sec[dataEntry[i]+4:], uint32(len(r.data)))
		relocs = append(relocs, uint32(dataEntry[i]))
		copy(sec[dataAt[i]:], r.data)
	}

	var out bytes.Buffer
	const headers = 20 + 40
	relocAt := headers + len(sec)
	symAt := relocAt + 10*len(relocs)
	le(&out, machine, uint16(1), uint32(0), uint32(symAt), uint32(1), uint16(0), uint16(0))
	out.WriteString(".rsrc\x00\x00\x00")
	le(&out, uint32(0), uint32(0), uint32(len(sec)), uint32(headers), uint32(relocAt), uint32(0), uint16(len(relocs)), uint16(0), uint32(0x40000040))
	out.Write(sec)
	for _, r := range relocs {
		le(&out, r, uint32(0), relocType)
	}
	out.WriteString(".rsrc\x00\x00\x00")
	le(&out, uint32(0), int16(1), uint16(0), uint8(3), uint8(0))
	le(&out, uint32(4))
	return out.Bytes()
}
