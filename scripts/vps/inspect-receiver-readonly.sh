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

section 'Important limits'
echo 'This report does not prove SSH contract:v2 or rollback readiness.'
echo 'Do not display authorized_keys, secret files, Docker inspect Env or private keys.'
echo 'No changes, uploads, docker removals, or deployment commands were performed.'
