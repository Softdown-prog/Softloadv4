"""Download one same-run encrypted artifact with bounded parallel HTTPS ranges.

Embedded verbatim in the workflow: the VPS runner never checks out repository code.
Only the two expected non-executable files are extracted. Never log signed URLs.
"""
import concurrent.futures
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import zipfile


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_request(path):
    return urllib.request.Request(
        'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + path,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json'})


def signed_artifact_url(artifact_id):
    # Do not forward the API Authorization header to the blob host.
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(api_request('/actions/artifacts/' + str(artifact_id) + '/zip'), timeout=30):
            raise RuntimeError('Expected artifact redirect')
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise RuntimeError('Artifact redirect HTTP ' + str(error.code)) from None
        url = error.headers.get('Location', '')
        if not url.startswith('https://'):
            raise RuntimeError('Invalid artifact redirect')
        return url


def download_range(url, target, start, end, total, refresh_url=None):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
            with urllib.request.urlopen(request, timeout=60) as response:
                expected = f'bytes {start}-{end}/{total}'
                if response.status != 206 or response.headers.get('Content-Range') != expected:
                    raise RuntimeError('Server did not honor bounded HTTP range')
                remaining = end - start + 1
                with target.open('wb') as output:
                    while remaining:
                        chunk = response.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise RuntimeError('Incomplete artifact range')
                        output.write(chunk)
                        remaining -= len(chunk)
            return target
        except (OSError, RuntimeError, urllib.error.URLError):
            target.unlink(missing_ok=True)
            if attempt == 3:
                # urllib exceptions may include a signed URL. Do not print them.
                raise RuntimeError('Artifact range failed after four attempts') from None
            time.sleep(attempt + 1)
            if refresh_url is not None:
                url = refresh_url()


def receive(url, folder, refresh_url=None):
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as response:
        total = int(response.headers.get('Content-Length', '0'))
    if not 0 < total <= 8 * 1024**3:
        raise RuntimeError('Unexpected artifact size')
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ranges-', dir=folder) as temporary:
        scratch = Path(temporary)
        chunk_size = max(512 * 1024, min(8 * 1024**2, math.ceil(total / 12)))
        ranges = [(start, min(start + chunk_size, total) - 1) for start in range(0, total, chunk_size)]
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            tasks = [pool.submit(download_range, url, scratch / str(i), start, end, total, refresh_url)
                     for i, (start, end) in enumerate(ranges)]
            for completed, task in enumerate(concurrent.futures.as_completed(tasks), 1):
                task.result()
                print(f'[HTTPS] Range {completed}/{len(tasks)} received', flush=True)
        archive = scratch / 'artifact.zip'
        with archive.open('wb') as output:
            for i in range(len(ranges)):
                with (scratch / str(i)).open('rb') as source:
                    shutil.copyfileobj(source, output)
                (scratch / str(i)).unlink()
        with zipfile.ZipFile(archive) as zipped:
            if sorted(zipped.namelist()) != ['image.enc', 'image.mac']:
                raise RuntimeError('Unexpected artifact entries')
            for name in ('image.enc', 'image.mac'):
                info = zipped.getinfo(name)
                if info.file_size > total or (name == 'image.mac' and info.file_size > 128):
                    raise RuntimeError('Unexpected artifact member size')
                with zipped.open(name) as source, (folder / name).open('wb') as output:
                    shutil.copyfileobj(source, output)
        elapsed = max(time.monotonic() - started, 0.001)
        print(f'[HTTPS] {total} encrypted bytes in {elapsed:.1f}s ({total / elapsed / 1024**2:.2f} MiB/s)', flush=True)


def main():
    request = api_request('/actions/runs/' + os.environ['GITHUB_RUN_ID'] + '/artifacts?per_page=100')
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    matches = [a for a in data['artifacts']
               if a['name'] == os.environ['ARTIFACT_NAME'] and not a['expired']]
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one same-run artifact')
    artifact = matches[0]
    run = artifact.get('workflow_run', {})
    if run.get('head_sha') != os.environ['GITHUB_SHA']:
        raise RuntimeError('Artifact revision differs from workflow revision')
    refresh = lambda: signed_artifact_url(artifact['id'])
    receive(refresh(), Path(os.environ['OUTPUT_DIR']), refresh)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('HTTPS artifact delivery failed; no activation. Check range/download step.') from None
