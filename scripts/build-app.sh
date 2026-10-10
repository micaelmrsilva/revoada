#!/bin/bash
# Monta dist/Revoada.app: servidor compilado + página + janela nativa.
# Uso: scripts/build-app.sh [--install]   (--install copia para /Applications)
set -euo pipefail
cd "$(dirname "$0")/.."
APP=dist/Revoada.app
RES=$APP/Contents/Resources
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$RES/assets/public" "$RES/assets/vendor"

bun build --compile --minify server.ts --outfile "$RES/revoada-server" >/dev/null
cp public/* "$RES/assets/public/"
cp node_modules/@xterm/xterm/lib/xterm.js node_modules/@xterm/xterm/css/xterm.css node_modules/@xterm/addon-fit/lib/addon-fit.js "$RES/assets/vendor/"

ICONSET=$(mktemp -d)/AppIcon.iconset
swift scripts/render-icon.swift public/icon.svg "$ICONSET"
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"

swiftc -O -swift-version 5 desktop/main.swift desktop/status.swift -o "$APP/Contents/MacOS/Revoada" -framework AppKit -framework WebKit
cp desktop/Info.plist "$APP/Contents/Info.plist"
# Assinatura. Sem SIGN_ID fica ad hoc (roda só nesta máquina sem aviso).
# Para distribuir: SIGN_ID="Developer ID Application: Nome (TEAMID)" e, pra notarizar,
# NOTARY_PROFILE=<perfil criado com `xcrun notarytool store-credentials`>.
if [ -n "${SIGN_ID:-}" ]; then
  codesign --force --options runtime --timestamp --entitlements desktop/entitlements.plist --sign "$SIGN_ID" "$RES/revoada-server"
  codesign --force --options runtime --timestamp --entitlements desktop/entitlements.plist --sign "$SIGN_ID" "$APP"
else
  codesign --force --deep --sign - "$APP" 2>/dev/null
fi
echo "pronto: $APP ($(du -sh "$APP" | cut -f1))"

if [ "${1:-}" = "--zip" ]; then
  ditto -c -k --keepParent "$APP" dist/Revoada.zip
  if [ -n "${SIGN_ID:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit dist/Revoada.zip --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP" && ditto -c -k --keepParent "$APP" dist/Revoada.zip
    echo "notarizado: dist/Revoada.zip"
  else
    echo "zip sem notarização: dist/Revoada.zip (em outro Mac: clique direito > Abrir na primeira vez)"
  fi
fi

if [ "${1:-}" = "--install" ]; then
  rm -rf /Applications/Revoada.app && cp -R "$APP" /Applications/Revoada.app
  echo "instalado em /Applications/Revoada.app"
fi
