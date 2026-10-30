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
        self.stack = self.root / 'stack'; self.stack.mkdir()
        (self.stack / '.env').write_text('SOFTLOAD_IMAGE_TAG=' + ('b' * 40) + '\n')
        source = source.replace('/opt/softload-infra/softload', str(self.stack))
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

    def retire_agent(self):
        with (self.stack / '.env').open('a') as file:
            file.write('SOFTLOAD_AGENT_RETIRED=1\n')

    def test_retired_agent_reuse_needs_no_image_and_preserves_legacy_handshake(self):
        self.retire_agent()
        self.assertEqual(self.run_receiver('contract:v3').stdout.strip(), 'softload-deploy:v3:app')
        self.assertEqual(self.run_receiver('contract:v2').stdout.strip(), 'softload-deploy:v2:app,agent')
        self.assertEqual(self.run_receiver('reuse:agent:' + SHA).returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_retired_transport_is_verified_and_never_loaded(self):
        self.retire_agent()
        archive = self.stage / ('softload-agent-' + SHA + '.tar.gz')
        archive.write_bytes(b'retired transport')
        good = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.assertEqual(self.run_receiver(f'finish:agent:{SHA}:{"b"*64}').returncode, 4)
        self.assertTrue(archive.exists())
        self.assertEqual(self.run_receiver(f'finish:agent:{SHA}:{good}').returncode, 0)
        self.assertFalse(archive.exists()); self.assertFalse(self.marker.exists())

    def test_app_only_deploy_never_inspects_starts_or_waits_for_agent(self):
        self.retire_agent()
        self.tool('curl', '#!/bin/sh\nexit 0\n')
        self.tool('docker', f'''#!/bin/sh
case "$*" in *agent*) echo 'Unexpected Agent operation' >&2; exit 99;; esac
case "$1 $2" in
 'image inspect') exit 0;;
 'compose -f') if [ "$4" = ps ]; then echo container; fi; exit 0;;
 'ps -aq') echo container; exit 0;;
 'inspect -f') echo healthy; exit 0;;
 'inspect --format') echo softload-app:{SHA}; exit 0;;
 'image ls') echo 'softload-app:{SHA} sha256:current'; exit 0;;
esac
exit 91
''')
        result = self.run_receiver('deploy:' + SHA)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_app_only_failed_health_restores_previous_revision_without_agent(self):
        self.retire_agent()
        self.script.write_text(self.script.read_text().replace('seq 1 36', 'seq 1 1').replace('sleep 5', 'sleep 0'))
        log = self.root / 'docker-calls'
        self.tool('docker', f'''#!/bin/sh
echo "$*" >> '{log}'
case "$*" in *agent*) exit 99;; esac
case "$1 $2" in
 'image inspect') exit 0;;
 'compose -f') if [ "$4" = ps ]; then echo container; fi; exit 0;;
 'inspect -f') echo unhealthy; exit 0;;
esac
exit 91
''')
        result = self.run_receiver('deploy:' + SHA)
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertIn('SOFTLOAD_IMAGE_TAG=' + 'b' * 40, (self.stack / '.env').read_text())
        self.assertNotIn('agent', log.read_text())
        self.assertEqual(log.read_text().count('up -d --no-build app'), 2)

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
        self.assertIn('grep -Fxq "$ref"',source)
        self.assertIn('{{.Config.Image}}',source)

    def test_healthy_deploy_removes_old_alias_but_keeps_current_refs_and_other_projects(self):
        stack=self.stack;(stack/'.env').write_text('SOFTLOAD_IMAGE_TAG='+('b'*40)+'\n')
        source=self.script.read_text().replace('/opt/softload-infra/softload',str(stack))
        self.script.write_text(source)
        self.tool('curl','#!/bin/sh\nexit 0\n')
        log=self.root/'removed'
        self.tool('docker', f'''#!/bin/sh
case "$1 $2" in
 'image inspect') exit 0;;
 'compose -f') if [ "$4" = ps ]; then echo container; fi; exit 0;;
 'ps -aq') echo container; exit 0;;
 'inspect -f') echo healthy; exit 0;;
 'inspect --format') printf '%s\\n' softload-app:{SHA} softload-agent:{SHA}; exit 0;;
 'image ls') printf '%s\\n' 'softload-app:{SHA} sha256:current' 'softload-agent:{SHA} sha256:shared' 'softload-agent:old sha256:shared' 'other-project:old sha256:other'; exit 0;;
 'image rm') echo "$3" >> '{log}'; exit 0;;
esac
exit 91
''')
        result=self.run_receiver('deploy:'+SHA)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(log.read_text().strip(),'softload-agent:old')

if __name__=='__main__':unittest.main()
