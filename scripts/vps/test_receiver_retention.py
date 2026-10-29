"""Offline receiver tests; production paths are replaced only in temporary fixtures."""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SOURCE = Path(__file__).with_name('softload-actions-receiver.sh')
SHA = 'a' * 40

class ReceiverRetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.stage = self.root / 'stage'; self.stage.mkdir()
        self.bin = self.root / 'bin'; self.bin.mkdir()
        self.lock = self.root / 'deploy.lock'
        self.marker = self.root / 'loaded'
        self.script = self.root / 'receiver'
        source = SOURCE.read_text()
        source = source.replace('export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                                f'export PATH={self.bin}:/usr/bin:/bin')
        source = source.replace('/run/lock/softload-actions-deploy.lock', str(self.lock))
        source = source.replace('/var/lib/softload-image-staging', str(self.stage))
        source = source.replace('/usr/bin/rrsync', str(self.bin / 'rrsync'))
        self.script.write_text(source)
        self.tool('docker', f'''#!/bin/sh
if [ "$1 $2" = "image inspect" ]; then test -e '{self.marker}'; exit $?; fi
if [ "$1" = load ]; then touch '{self.marker}'; exit 0; fi
exit 90
''')
        self.tool('rrsync', f"#!/bin/sh\ntouch '{self.root / 'receiving'}'\nsleep 2\n")

    def tool(self, name, source):
        file = self.bin / name; file.write_text(source); file.chmod(0o700)

    def run_receiver(self, command):
        return subprocess.run(['bash', str(self.script)], env=dict(os.environ, SSH_ORIGINAL_COMMAND=command),
                              capture_output=True, text=True, timeout=5)

    def archive(self):
        archive = self.stage / ('softload-app-' + SHA + '.tar.gz')
        archive.write_bytes(b'transport')
        return archive, hashlib.sha256(b'transport').hexdigest()

    def test_syntax_and_readonly_handshake(self):
        self.assertEqual(subprocess.run(['bash','-n',str(self.script)]).returncode,0)
        self.assertEqual(self.run_receiver('contract:v2').stdout.strip(),'softload-deploy:v2:app,agent')

    def test_successful_import_deletes_transport(self):
        archive, digest = self.archive()
        result = self.run_receiver(f'finish:app:{SHA}:{digest}')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(self.marker.exists()); self.assertFalse(archive.exists())

    def test_already_loaded_retry_still_deletes_verified_transport(self):
        self.marker.touch(); archive,digest=self.archive()
        self.assertEqual(self.run_receiver(f'finish:app:{SHA}:{digest}').returncode,0)
        self.assertFalse(archive.exists())

    def test_checksum_failure_preserves_transport(self):
        archive,_=self.archive()
        self.assertNotEqual(self.run_receiver(f'finish:app:{SHA}:{"b"*64}').returncode,0)
        self.assertTrue(archive.exists()); self.assertFalse(self.marker.exists())

    def test_receiver_lock_covers_entire_rsync_and_blocks_finish_and_cleanup(self):
        process=subprocess.Popen(['bash',str(self.script)],env=dict(os.environ,SSH_ORIGINAL_COMMAND='rsync --server -v . file'))
        try:
            for _ in range(100):
                if (self.root/'receiving').exists(): break
                time.sleep(.01)
            self.assertTrue((self.root/'receiving').exists())
            with self.lock.open('a') as file:
                with self.assertRaises(BlockingIOError):fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
            archive,digest=self.archive()
            self.assertEqual(self.run_receiver(f'finish:app:{SHA}:{digest}').returncode,3)
            self.assertTrue(archive.exists())
        finally:process.wait(timeout=5)

    def test_cleanup_is_project_scoped_and_never_deletes_volumes(self):
        source=SOURCE.read_text()
        self.assertNotIn('docker image prune',source)
        self.assertNotIn('docker system prune',source)
        self.assertIn('softload-app:*|softload-agent:*',source)
        self.assertIn('grep -Fxq "$id"',source)

if __name__=='__main__':unittest.main()
