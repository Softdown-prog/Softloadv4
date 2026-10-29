#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
case "${SSH_ORIGINAL_COMMAND:-}" in
  rsync\ --server\ *|finish:*|reuse:*|deploy:*)
    exec 9>/run/lock/softload-actions-deploy.lock
    flock -n 9 || { echo "Another transfer/deploy is running" >&2; exit 3; }
    ;;
esac
case "${SSH_ORIGINAL_COMMAND:-}" in
  contract:v2)
    echo "softload-deploy:v2:app,agent"
    ;;
  current)
    cd /opt/softload-infra/softload
    current="$(sed -n 's/^SOFTLOAD_IMAGE_TAG=//p' .env | tail -n 1)"
    [[ "$current" =~ ^[0-9a-f]{40}$ ]] || exit 2
    printf '%s\n' "$current"
    ;;
  reuse:*)
    payload="${SSH_ORIGINAL_COMMAND#reuse:}"
    service="${payload%%:*}"
    sha="${payload#*:}"
    [[ "$service" =~ ^(agent)$ ]] || exit 2
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
    cd /opt/softload-infra/softload
    current="$(sed -n 's/^SOFTLOAD_IMAGE_TAG=//p' .env | tail -n 1)"
    [[ "$current" =~ ^[0-9a-f]{40}$ ]] || exit 2
    docker image inspect "softload-$service:$current" >/dev/null
    docker image tag "softload-$service:$current" "softload-$service:$sha"
    echo "Reused $service from $current"
    ;;
  rsync\ --server\ *)
    /usr/bin/rrsync -wo -no-del -munge /var/lib/softload-image-staging
    ;;
  finish:*)
    payload="${SSH_ORIGINAL_COMMAND#finish:}"
    [[ "$payload" =~ ^(app|agent):([0-9a-f]{40}):([0-9a-f]{64})$ ]] || exit 2
    service="${BASH_REMATCH[1]}"
    sha="${BASH_REMATCH[2]}"
    expected="${BASH_REMATCH[3]}"
    archive="/var/lib/softload-image-staging/softload-$service-$sha.tar.gz"
    if docker image inspect "softload-$service:$sha" >/dev/null 2>&1; then
      if [[ -e "$archive" || -L "$archive" ]]; then
        [[ -f "$archive" && ! -L "$archive" ]] || exit 3
        actual="$(sha256sum "$archive" | cut -d' ' -f1)"
        [[ "$actual" == "$expected" ]] || exit 4
        rm -f -- "$archive"
      fi
      echo "Image already loaded: softload-$service:$sha"
      exit 0
    fi
    [[ -f "$archive" && ! -L "$archive" ]] || { echo 'Archive missing' >&2; exit 3; }
    actual="$(sha256sum "$archive" | cut -d' ' -f1)"
    [[ "$actual" == "$expected" ]] || { echo 'Archive checksum mismatch' >&2; exit 4; }
    docker load -i "$archive"
    docker image inspect "softload-$service:$sha" >/dev/null
    rm -f -- "$archive"
    echo "Loaded verified image: softload-$service:$sha"
    ;;
  load)
    echo 'Legacy image stream disabled; use resumable rsync transfer' >&2
    exit 75
    ;;
  deploy:*)
    sha="${SSH_ORIGINAL_COMMAND#deploy:}"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
    cd /opt/softload-infra/softload
    for service in app agent; do docker image inspect "softload-$service:$sha" >/dev/null; done
    previous="$(sed -n 's/^SOFTLOAD_IMAGE_TAG=//p' .env | tail -n 1)"
    sed -i "s/^SOFTLOAD_IMAGE_TAG=.*/SOFTLOAD_IMAGE_TAG=$sha/" .env
    if ! docker compose -f compose.vps.yaml config --quiet || ! docker compose -f compose.vps.yaml up -d --no-build; then
      sed -i "s/^SOFTLOAD_IMAGE_TAG=.*/SOFTLOAD_IMAGE_TAG=$previous/" .env
      docker compose -f compose.vps.yaml up -d --no-build
      exit 4
    fi
    healthy=false
    for attempt in $(seq 1 36); do
      healthy=true
      for service in app agent; do
        cid="$(docker compose -f compose.vps.yaml ps -q "$service")"
        status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
        [[ "$status" == healthy ]] || healthy=false
      done
      if [[ "$healthy" == true ]]; then break; fi
      sleep 5
    done
    if [[ "$healthy" != true ]]; then
      echo 'Health check failed; rolling back'
      sed -i "s/^SOFTLOAD_IMAGE_TAG=.*/SOFTLOAD_IMAGE_TAG=$previous/" .env
      docker compose -f compose.vps.yaml up -d --no-build
      exit 5
    fi
    if ! curl --fail --silent --show-error --max-time 15 --cacert /etc/ssl/certs/cloudflare-origin-ca-rsa.pem --resolve softload.analysepro.com:443:164.163.9.7 https://softload.analysepro.com/health >/dev/null; then
      echo "Origin health check failed; rolling back"
      sed -i "s/^SOFTLOAD_IMAGE_TAG=.*/SOFTLOAD_IMAGE_TAG=$previous/" .env
      docker compose -f compose.vps.yaml up -d --no-build
      exit 6
    fi
    # After a healthy activation, keep only images referenced by containers.
    used="$(docker ps -aq | xargs -r docker inspect --format '{{.Image}}')"
    while read -r ref id; do
      case "$ref" in softload-app:*|softload-agent:*) ;; *) continue;; esac
      if ! grep -Fxq "$id" <<< "$used"; then
        docker image rm "$ref" >/dev/null || echo "Could not remove unused $ref" >&2
      fi
    done < <(docker image ls --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}')
    echo "Deployed $sha"
    ;;
  *) echo 'Command not allowed' >&2; exit 2;;
esac
