#!/usr/bin/env python3
"""One-time, fail-closed migration of the installed Softload restricted SSH receiver.

Run as root on the VPS only, via the authenticated administrative panel SSH terminal.
Never run this from the unprivileged GitHub self-hosted runner.
"""
import datetime
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

RECEIVER = Path('/usr/local/sbin/softload-actions-receiver')
STACK = Path('/opt/softload-infra/softload')
LOCK = Path('/run/lock/softload-actions-deploy.lock')
EXPECTED = 'softload-deploy:v2:app,agent'
ANCHOR = 'case "${SSH_ORIGINAL_COMMAND:-}" in\n'
HANDSHAKE = '  contract:v2)\n    echo "softload-deploy:v2:app,agent"\n    ;;\n'


def fail(message):
    raise RuntimeError(message)


def run(command, **kwargs):
    return subprocess.run(command, text=True, capture_output=True, check=False, timeout=18, **kwargs)


def verify_script(path):
    syntax = run(['bash', '-n', str(path)])
    if syntax.returncode:
        fail('Sintaxe Bash invalida: ' + syntax.stderr.strip()[:180])
    env = dict(os.environ, SSH_ORIGINAL_COMMAND='contract:v2')
    probe = run(['bash', str(path)], env=env)
    if probe.returncode or probe.stdout.strip() != EXPECTED:
        fail('Resposta contract:v2 nao corresponde ao contrato esperado.')


def check_compose():
    if not (STACK / 'compose.vps.yaml').is_file():
        fail('compose.vps.yaml nao encontrado; nenhuma alteracao realizada.')
    result = run(['docker', 'compose', '-f', 'compose.vps.yaml', 'config', '--services'], cwd=STACK)
    if result.returncode:
        fail('Compose invalido: ' + result.stderr.strip()[:180])
    services = set(result.stdout.splitlines())
    if not {'app', 'agent'}.issubset(services):
        fail('Compose nao contem app e agent como servicos ativos.')
    if {'sandbox', 'embeddings'} & services:
        fail('Compose ainda ativa sandbox ou embeddings; corrigir isso antes do contrato v2.')
    print('PREFLIGHT_OK: Compose ativo contem app e agent, sem sandbox/embeddings.')


def main():
    if os.geteuid() != 0:
        fail('Somente o Terminal VPS administrativo com root pode migrar o receptor.')
    if RECEIVER.is_symlink() or not RECEIVER.is_file():
        fail('Receptor ausente ou link simbolico; revisao manual necessaria.')
    check_compose()
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open('a+') as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail('Deploy em andamento; nao alterei o receptor.')
        original = RECEIVER.read_bytes()
        if len(original) > 128 * 1024 or not original.startswith(b'#!/usr/bin/env bash\n'):
            fail('Formato inesperado do receptor; nenhuma alteracao realizada.')
        text = original.decode('utf-8')
        if text.count(ANCHOR) != 1:
            fail('Ancora SSH_ORIGINAL_COMMAND inesperada; nenhuma alteracao realizada.')
        if 'contract:v2)' in text:
            verify_script(RECEIVER)
            print('JA_COMPATIVEL: contract:v2 validado; nenhuma alteracao necessaria.')
            return
        required = ('  current)', '  reuse:*)', '  finish:*)', '  deploy:*)',
                    'for service in app agent; do', 'compose.vps.yaml')
        missing = [token for token in required if token not in text]
        if missing:
            fail('Estrutura do receptor divergente: ' + ', '.join(missing))
        if any(word in text.lower() for word in ('softload-sandbox:', 'softload-embeddings:')):
            fail('Referencias a imagens antigas no receptor; revisar antes de migrar.')
        patched = text.replace(ANCHOR, ANCHOR + HANDSHAKE, 1).encode('utf-8')
        stat_before = RECEIVER.stat()
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = RECEIVER.with_name(RECEIVER.name + '.backup-' + stamp)
        if backup.exists():
            fail('Backup ja existe: ' + str(backup))
        with backup.open('xb') as f:
            os.fchmod(f.fileno(), stat.S_IMODE(stat_before.st_mode))
            os.fchown(f.fileno(), stat_before.st_uid, stat_before.st_gid)
            f.write(original)
            f.flush()
            os.fsync(f.fileno())
        shutil.copystat(RECEIVER, backup)
        fd, tmp = tempfile.mkstemp(prefix='.' + RECEIVER.name + '.', dir=str(RECEIVER.parent))
        try:
            with os.fdopen(fd, 'wb') as f:
                os.fchmod(f.fileno(), stat.S_IMODE(stat_before.st_mode))
                os.fchown(f.fileno(), stat_before.st_gid, stat_before.st_gid)
                f.write(patched)
                f.flush()
                os.fsync(f.fileno())
            shutil.copystat(RECEIVER, tmp)
            verify_script(tmp)
            if hashlib.sha256(RECEIVER.read_bytes()).digest() != hashlib.sha256(original).digest():
                fail('Receptor modificado simultaneamente; nenhuma troca efetuada.')
            os.replace(tmp, RECEIVER)
            try:
                verify_script(RECEIVER)
            except Exception:
                restored_fd, restored = tempfile.mkstemp(prefix='.receiver-restore.', dir=str(RECEIVER.parent))
                with os.fdopen(restored_fd, 'wb') as f:
                    os.fchmod(f.fileno(), stat.S_IMODE(stat_before.st_mode))
                    os.fchown(f.fileno(), stat_before.st_uid, stat_before.st_gid)
                    f.write(original)
                    f.flush()
                    os.fsync(f.fileno())
                shutil.copystat(backup, restored)
                os.replace(restored, RECEIVER)
                raise
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        print('MIGRACAO_OK: contract:v2 responde ' + EXPECTED)
        print('BACKUP_OK: ' + str(backup))
        print('NENHUM_CONTAINER_ALTERADO: para publicar, disparar o workflow de deploy.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.TimeoutExpired, UnicodeError) as error:
        print('MIGRACAO_BLOQUEADA: ' + str(error)[:250], file=sys.stderr)
        sys.exit(1)
