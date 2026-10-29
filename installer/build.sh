#!/usr/bin/env sh
set -eu
export CGO_ENABLED=0
cd "$(dirname "$0")"
go generate ./...
go test ./...
VERSION=$(cat payload/VERSION)
rm -rf dist && mkdir -p dist
LDFLAGS="-s -w"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS -H windowsgui" -o dist/PrivacyCleanupInstaller-windows-x64.exe .
GOOS=windows GOARCH=arm64 go build -trimpath -ldflags "$LDFLAGS -H windowsgui" -o dist/PrivacyCleanupInstaller-windows-arm64.exe .
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS" -o dist/PrivacyCleanupInstaller-linux-x64 .
GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "$LDFLAGS" -o dist/PrivacyCleanupInstaller-linux-arm64 .
for arch in arm64 amd64; do
  name="PrivacyCleanup Installer.app"
  root="dist/mac-$arch/$name"
  mkdir -p "$root/Contents/MacOS"
  GOOS=darwin GOARCH=$arch go build -trimpath -ldflags "$LDFLAGS" -o "$root/Contents/MacOS/installer" .
  sed "s/{{VERSION}}/$VERSION/" macos/Info.plist > "$root/Contents/Info.plist"
  label=$([ "$arch" = arm64 ] && echo apple-silicon || echo intel)
  (cd "dist/mac-$arch" && zip -qry "../PrivacyCleanupInstaller-macos-$label.zip" "$name")
  rm -rf "dist/mac-$arch"
done
(cd dist && sha256sum * > SHA256SUMS.txt)
ls -la dist
