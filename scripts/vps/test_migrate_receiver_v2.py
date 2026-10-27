import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('migrate_receiver_v2', ROOT / 'migrate_receiver_v2.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

EXISTING = '''#!/usr/bin/env bash
set -euo pipefail
case "${SSH_ORIGINAL_COMMAND:-}" in
  current)
    echo example
    ;;
  reuse:*)
    echo reuse
    ;;
  finish:*)
    echo finish
    ;;
  deploy:*)
    for service in app agent; do :; done
    # compose.vps.yaml
    echo deploy
    ;;
esac
'''


class ReceiverMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.receiver = root / 'softload-actions-receiver'
        self.receiver.write_text(EXISTING)
        self.receiver.chmod(0o750)
        self.stack = root / 'stack'
        self.stack.mkdir()
        (self.stack / 'compose.vps.yaml').write_text('services:\n  app:\n    image: app\n  agent:\n    image: agent\n')
        self.lock = root / 'deploy.lock'
        self.docker_services = 'app\nagent\n'
        original_run = module.run

        def run(command, **kwargs):
            if command[0] == 'docker':
                return types.SimpleNamespace(returncode=0, stdout=self.docker_services, stderr='')
            return original_run(command, **kwargs)

        patchers = [
            patch.object(module, 'RECEIVER', self.receiver),
            patch.object(module, 'STACK', self.stack),
            patch.object(module, 'LOCK', self.lock),
            patch.object(module.os, 'geteuid', return_value=0),
            patch.object(module, 'run', side_effect=run),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def execute(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return module.main()

    def test_creates_backup_and_validates_handshake_without_changing_other_commands(self):
        self.execute()
        text = self.receiver.read_text()
        self.assertIn('contract:v2)\n    echo "softload-deploy:v2:app,agent"', text)
        self.assertEqual(text.replace(module.HANDSHAKE, ''), EXISTING)
        self.assertEqual(self.receiver.stat().st_mode & 0o777, 0o750)
        backups = list(self.receiver.parent.glob('softload-actions-receiver.backup-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), EXISTING)
        module.verify_script(self.receiver)
        self.execute()
        self.assertEqual(len(list(self.receiver.parent.glob('softload-actions-receiver.backup-*'))), 1)

    def test_blocks_when_deprecated_services_are_active_in_compose(self):
        self.docker_services = 'app\nagent\nsandbox\n'
        with self.assertRaisesRegex(RuntimeError, 'sandbox'):
            self.execute()
        self.assertEqual(self.receiver.read_text(), EXISTING)
        self.assertEqual(list(self.receiver.parent.glob('*.backup-*')), [])

    def test_blocks_when_installed_receiver_uses_unexpected_structure(self):
        self.receiver.write_text(EXISTING.replace('  finish:*)', '  other:*)'))
        with self.assertRaisesRegex(RuntimeError, 'Estrutura'):
            self.execute()
        self.assertNotIn('contract:v2)', self.receiver.read_text())

    def test_blocks_without_root(self):
        with patch.object(module.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(RuntimeError, 'root'):
                self.execute()
        self.assertEqual(self.receiver.read_text(), EXISTING)


if __name__ == '__main__':
    unittest.main()
