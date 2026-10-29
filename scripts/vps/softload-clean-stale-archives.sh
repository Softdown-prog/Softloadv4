#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# A downloader can be active before rsync acquires the receiver lock.
if pgrep -x rsync >/dev/null || pgrep -x 'Runner\.Worker' >/dev/null; then
  echo 'Cleanup skipped: deployment/transfer active'
  exit 0
fi
exec python3 /usr/local/lib/softload/cleanup_staging.py --apply --confirm-idle --min-age-hours 0
