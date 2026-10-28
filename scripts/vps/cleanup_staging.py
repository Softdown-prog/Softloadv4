#!/usr/bin/env python3
"""Audit and optionally remove stale Softload Docker image transfer archives.

No Docker images, containers, volumes or backups are removed. Run from the
administrative VPS terminal, not from the unprivileged GitHub Actions runner.
"""
import argparse
import fcntl
import os
from pathlib import Path
import re
import stat
import sys
import time

STAGING = Path("/var/lib/softload-image-staging")
LOCK = Path("/run/lock/softload-actions-deploy.lock")
ARCHIVE = re.compile(r"softload-(?:app|agent)-[0-9a-f]{40}\.tar\.gz\Z")


def candidates(folder, min_age_hours, now=None):
    """Return only old, top-level regular release tarballs (never symlinks)."""
    if folder.is_symlink() or not folder.is_dir():
        raise RuntimeError(f"Invalid staging directory: {folder}")
    cutoff = (time.time() if now is None else now) - 3600 * min_age_hours
    found = []
    with os.scandir(folder) as entries:
        for entry in entries:
            if not ARCHIVE.fullmatch(entry.name):
                continue
            if not entry.is_file(follow_symlinks=False):
                continue
            info = entry.stat(follow_symlinks=False)
            if info.st_mtime > cutoff:
                continue
            found.append((folder / entry.name, info))
    return sorted(found, key=lambda pair: pair[0].name)


def remove_if_unchanged(file_path, old):
    """Avoid deleting a file updated or replaced after inventory."""
    current = file_path.lstat()
    if (not stat.S_ISREG(current.st_mode) or
            (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) !=
            (old.st_dev, old.st_ino, old.st_size, old.st_mtime_ns)):
        raise RuntimeError(f"File changed during inspection; abort: {file_path}")
    file_path.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="delete eligible tarballs")
    parser.add_argument("--min-age-hours", type=float, default=24,
                        help="ignore recently modified files (default: 24 hours)")
    parser.add_argument("--confirm-idle", action="store_true",
                        help="confirm that no transfer/deploy is running; mandatory for --apply")
    args = parser.parse_args(argv)
    if not 0 <= args.min_age_hours <= 8760:
        parser.error("--min-age-hours must be between 0 and 8760")
    if args.apply and not args.confirm_idle:
        parser.error("--apply requires --confirm-idle after checking GitHub Actions/receiver")
    if args.apply and os.geteuid() != 0:
        parser.error("--apply requires root in the administrative VPS terminal")

    if not STAGING.exists():
        print("Nothing to clean: staging directory absent.")
        return 0

    # The receiver also uses this lock for critical deploy operations.
    # Its rsync phase may NOT hold this lock; --confirm-idle is essential.
    lock_fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Deploy lock is busy; nothing deleted")
        found = candidates(STAGING, args.min_age_hours)
        total = sum(item.st_size for _, item in found)
        for path, info in found:
            print(f"{info.st_size:>12} bytes  {path}")
        print(f"{len(found)} eligible archives, {total} bytes total")
        if not args.apply:
            print("DRY RUN: nothing deleted. Use --apply --confirm-idle after verifying no active deploy.")
            return 0
        # Fail closed if a candidate changes mid-run.
        for path, info in found:
            remove_if_unchanged(path, info)
            print(f"DELETED {path.name}")
        print(f"Removed {len(found)} archives ({total} bytes of files).")
        return 0
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError) as exc:
        print(f"CLEANUP_BLOCKED: {exc}", file=sys.stderr)
        sys.exit(1)
