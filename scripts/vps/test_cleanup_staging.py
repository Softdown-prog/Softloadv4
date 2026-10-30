"""Offline safety tests; never touch the actual VPS staging directory."""
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("cleanup_staging", Path(__file__).with_name("cleanup_staging.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

OLD = "softload-app-" + "a" * 40 + ".tar.gz"
NEW = "softload-app-" + "b" * 40 + ".tar.gz"


class StagingCleanupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name) / "stage"
        self.folder.mkdir()
        self.lock = Path(self.tmp.name) / "deploy.lock"

    def file(self, filename, age_seconds=3600):
        file_path = self.folder / filename
        file_path.write_bytes(b"test bytes")
        timestamp = time.time() - age_seconds
        os.utime(file_path, (timestamp, timestamp))
        return file_path

    def test_exact_archive_names_and_symlink_exclusions(self):
        good = self.file(OLD)
        self.file("softload-app-notsha.tar.gz")
        self.file(NEW + ".part")
        (self.folder / NEW).symlink_to(good)
        result = module.candidates(self.folder, 0)
        self.assertEqual([f.name for f, _ in result], [OLD])

    def test_minimum_age_prevents_recent_transfer_deletion(self):
        older = self.file(OLD, age_seconds=7200)
        recent = self.file(NEW, age_seconds=60)
        found = module.candidates(self.folder, 1)
        self.assertEqual([p for p, _ in found], [older])
        self.assertTrue(recent.exists())

    def test_dry_run_does_not_delete(self):
        path = self.file(OLD)
        with patch.object(module, "STAGING", self.folder), patch.object(module, "LOCK", self.lock):
            self.assertEqual(module.main(["--min-age-hours", "0"]), 0)
        self.assertTrue(path.exists())

    def test_apply_requires_idle_confirmation(self):
        with patch.object(module, "STAGING", self.folder), patch.object(module, "LOCK", self.lock), patch.object(module.os, "geteuid", return_value=0):
            with self.assertRaises(SystemExit):
                module.main(["--apply", "--min-age-hours", "0"])

    def test_apply_removes_only_matching_archives(self):
        good = self.file(OLD)
        keep = self.file("other-data.tar.gz")
        with patch.object(module, "STAGING", self.folder), patch.object(module, "LOCK", self.lock), patch.object(module.os, "geteuid", return_value=0):
            self.assertEqual(module.main(["--apply", "--confirm-idle", "--min-age-hours", "0"]), 0)
        self.assertFalse(good.exists())
        self.assertTrue(keep.exists())

    def test_replaced_file_is_not_deleted(self):
        path = self.file(OLD)
        old = path.lstat()
        path.write_bytes(b"new content")
        with self.assertRaises(RuntimeError):
            module.remove_if_unchanged(path, old)
        self.assertTrue(path.exists())

    def test_rejects_staging_directory_symlink(self):
        alias = Path(self.tmp.name) / "alias"
        alias.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            module.candidates(alias, 0)


if __name__ == "__main__":
    unittest.main()
