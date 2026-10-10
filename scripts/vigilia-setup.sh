#!/bin/bash
# Libera a Revoada pra manter o Mac acordado com a tampa fechada enquanto os agentes trabalham.
# Rode você mesmo no Terminal: pede a senha de administrador.
#
# O que instala:
#   /etc/sudoers.d/revoada   seu usuário pode rodar, sem senha, só estes dois comandos:
#                              pmset -a disablesleep 1   e   pmset -a disablesleep 0
#   ~/Library/LaunchAgents/dev.revoada.vigia.plist
#                            vigia que roda a cada minuto e religa o sono do sistema se o app
#                            morreu ou passou do tempo máximo, e retoma apps que ficaram pausados
#
# Para desfazer:  scripts/vigilia-setup.sh --remover
set -euo pipefail
RULE=/etc/sudoers.d/revoada
AGENT="$HOME/Library/LaunchAgents/dev.revoada.vigia.plist"
BACKSTOP="$HOME/.revoada/vigia.sh"
LABEL=dev.revoada.vigia

if [ "${1:-}" = "--remover" ]; then
  sudo /usr/bin/pmset -a disablesleep 0 || true
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$AGENT" "$BACKSTOP"
  sudo rm -f "$RULE"
  echo "Removido. O sono do sistema está ligado."
  exit 0
fi

TMP=$(mktemp)
echo "$(id -un) ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0" > "$TMP"
# a regra só é instalada se o próprio sudo disser que está bem formada
sudo /usr/sbin/visudo -cf "$TMP"
sudo install -m 440 -o root -g wheel "$TMP" "$RULE"
rm -f "$TMP"

mkdir -p "$HOME/.revoada" "$(dirname "$AGENT")"
cat > "$BACKSTOP" <<'EOS'
#!/bin/bash
# Vigia da Revoada: se o sono do sistema ficou desligado e o app não está mais cuidando
# (morreu, ou passou do prazo), religa. Também retoma apps que ficaram pausados.
S="$HOME/.revoada/vigil.json"
[ -f "$S" ] || exit 0
get() { /usr/bin/plutil -extract "$1" raw -o - "$S" 2>/dev/null; }
pid=$(get appPid); deadline=$(get deadline); disabled=$(get sleepDisabled); n=$(get frozen)
alive=0; [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
late=0; [ -n "$deadline" ] && [ "$(date +%s)" -gt "$deadline" ] && late=1
[ "$alive" = 1 ] && [ "$late" = 0 ] && exit 0
if [ "$disabled" = "true" ]; then
  /usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0 && echo "$(date '+%F %T') [vigia] sono do sistema religado (app vivo=$alive, prazo vencido=$late)" >> "$HOME/.revoada/app.log"
fi
i=0
while [ "$i" -lt "${n:-0}" ]; do
  entry=$(get "frozen.$i"); p=${entry%%|*}; started=${entry#*|}
  # só retoma se ainda é o mesmo processo que foi pausado
  [ "$(ps -o lstart= -p "$p" 2>/dev/null | sed 's/^ *//;s/ *$//')" = "$started" ] && kill -CONT "$p"
  i=$((i + 1))
done
[ "$alive" = 0 ] && printf '{"appPid":0,"sleepDisabled":false,"deadline":0,"frozen":[]}' > "$S"
exit 0
EOS
chmod 700 "$BACKSTOP"
cat > "$AGENT" <<EOS
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$BACKSTOP</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOS
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo "Pronto. Na Revoada: Ajustes > Continuar com a tampa fechada."
