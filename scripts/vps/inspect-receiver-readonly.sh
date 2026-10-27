#!/usr/bin/env bash
# Softload VPS — read-only receiver inventory.
# Run on the VPS with an account authorized to inspect the deployment receiver.
# Prints no key contents, container secrets, Docker mounts, or ENV values.
set -euo pipefail
export LC_ALL=C

section() { printf '\n## %s\n' "$1"; }
section 'Operator and machine'
printf 'user=%s\n' "$(id -un)"
printf 'kernel=%s\n' "$(uname -srm)"
section 'Filesystem summary'
df -h / || true

section 'SSH forced-command presence (no key material)'
if [[ -r /root/.ssh/authorized_keys ]]; then
  awk '
    /command="/ {
      count++
      if (match($0, /command="[^"]+"/)) {
        raw=substr($0, RSTART+9, RLENGTH-10)
        # Report only paths that contain no shell syntax or parameters.
        if (raw ~ /^\/[a-zA-Z0-9_./-]+$/) print "forced_command_path=" raw
        else print "forced_command_path=[redacted complex command]"
      } else print "forced_command_path=[redacted]"
    }
    END { print "forced_command_entries=" count+0 }
  ' /root/.ssh/authorized_keys
else
  echo 'root_authorized_keys=[not readable by current user]'
fi

section 'Likely receiver file paths (metadata only)'
for directory in /usr/local/bin /usr/local/sbin /opt/softload /opt/softload-vps /srv /root; do
  [[ -d "$directory" ]] || continue
  find "$directory" -maxdepth 2 -type f \( -iname '*deploy*' -o -iname '*receiver*' -o -iname '*softload*' \) \
    -print 2>/dev/null | head -n 60 || true
done

section 'Softload container images and states (no configuration)'
if command -v docker >/dev/null 2>&1; then
  docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' 2>/dev/null \
    | grep -Ei 'softload|solaris|sandbox|embedding' || echo '[not readable or none]'
  section 'Docker disk accounting'
  docker system df 2>/dev/null || echo '[Docker socket not readable by current user]'
else
  echo '[Docker CLI missing]'
fi


section 'Receiver v2 static compatibility indicators'
# Read-only; never execute receiver code or print private keys / environment.
checked=0
while IFS= read -r candidate; do
  [[ -f "$candidate" && ! -L "$candidate" && -r "$candidate" ]] || continue
  case "$candidate" in
    /usr/local/bin/*|/usr/local/sbin/*|/opt/softload/*|/opt/softload-vps/*|/opt/softload-infra/*|/srv/*) ;;
    *) continue ;;
  esac
  checked=$((checked + 1))
  printf 'receiver_candidate=%s\n' "$candidate"
  if grep -qF 'contract:v2' "$candidate"; then
    echo '  contract_v2_literal=present'
  else
    echo '  contract_v2_literal=absent'
  fi
  if grep -qF 'softload-deploy:v2:app,agent' "$candidate"; then
    echo '  response_v2_literal=present'
  else
    echo '  response_v2_literal=absent'
  fi
  if grep -qE 'softload-(sandbox|embeddings)' "$candidate"; then
    echo '  legacy_image_references=present (possibly comments)'
  else
    echo '  legacy_image_references=not_detected'
  fi
  if [[ "$candidate" == *.sh ]]; then
    if bash -n "$candidate" 2>/dev/null; then
      echo '  shell_syntax=valid'
    else
      echo '  shell_syntax=invalid_or_not_bash'
    fi
  fi
  if ((checked >= 12)); then
    echo 'receiver_scan_limit=12'
    break
  fi
done < <(
  if [[ -r /root/.ssh/authorized_keys ]]; then
    awk '/command="/ {
      if (match($0, /command="[^"]+"/)) {
        path=substr($0, RSTART+9, RLENGTH-10)
        if (path ~ /^\/[a-zA-Z0-9_./-]+$/) print path
      }
    }' /root/.ssh/authorized_keys
  fi
  for directory in /usr/local/bin /usr/local/sbin /opt/softload /opt/softload-vps /opt/softload-infra /srv; do
    [[ -d "$directory" ]] || continue
    find "$directory" -maxdepth 3 -type f \( -iname '*deploy*.sh' -o -iname '*receiver*' \) -print 2>/dev/null | head -n 40 || true
  done
)
echo "receiver_candidates_checked=$checked"
echo 'Static indicators only; they cannot validate activation or rollback.'

section 'Important limits'
echo 'This report does not prove SSH contract:v2 or rollback readiness.'
echo 'Do not display authorized_keys, secret files, Docker inspect Env or private keys.'
echo 'No changes, uploads, docker removals, or deployment commands were performed.'
