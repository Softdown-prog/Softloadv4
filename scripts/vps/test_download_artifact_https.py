import concurrent.futures
import importlib.util
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('delivery', Path(__file__).with_name('download_artifact_https.py'))
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryTest(unittest.TestCase):
    def setUp(self):
        self.payload = b'x' * (3 * 1024**2)
        self.blob = self.make_zip({'image.enc': self.payload, 'image.mac': b'f' * 64})
        self.ranges = []
        self.bad_range = False
        self.fail_once = False
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_HEAD(self):
                self.send_response(200)
                self.send_header('Content-Length', len(owner.blob))
                self.end_headers()

            def do_GET(self):
                # API bearer credentials must never be sent to blob hosts.
                if self.headers.get('Authorization'):
                    self.send_error(403)
                    return
                interval = self.headers.get('Range', '')
                first, last = map(int, interval.removeprefix('bytes=').split('-'))
                if owner.fail_once and first == 0:
                    owner.fail_once = False
                    self.send_error(503)
                    return
                owner.ranges.append((first, last))
                self.send_response(206)
                actual = f'bytes {first}-{last}/{len(owner.blob)}'
                self.send_header('Content-Range', 'wrong' if owner.bad_range else actual)
                data = owner.blob[first:last + 1]
                self.send_header('Content-Length', len(data))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/archive'
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / 'release'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    @staticmethod
    def make_zip(entries):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_STORED) as archive:
            for name, contents in entries.items():
                archive.writestr(name, contents)
        return stream.getvalue()

    def test_roundtrip_uses_multiple_bounded_ranges_and_cleans_zip(self):
        delivery.receive(self.url, self.folder)
        self.assertEqual((self.folder / 'image.enc').read_bytes(), self.payload)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['image.enc', 'image.mac'])
        self.assertGreater(len(self.ranges), 1)
        intervals = sorted(self.ranges)
        self.assertEqual(intervals[0][0], 0)
        self.assertEqual(intervals[-1][1], len(self.blob) - 1)
        for left, right in zip(intervals, intervals[1:]):
            self.assertEqual(left[1] + 1, right[0])

    def test_transient_failure_retries_only_affected_range(self):
        self.fail_once = True
        with patch.object(delivery.time, 'sleep'), patch.object(delivery, 'signed_artifact_url', return_value=self.url) as refresh:
            delivery.receive(self.url, self.folder, refresh)
        refresh.assert_called_once()
        self.assertEqual((self.folder / 'image.enc').read_bytes(), self.payload)

    def test_server_ignoring_range_is_rejected(self):
        self.bad_range = True
        with patch.object(delivery.time, 'sleep'), self.assertRaises(RuntimeError):
            delivery.receive(self.url, self.folder)
        self.assertFalse((self.folder / 'image.enc').exists())

    def test_unexpected_archive_path_cannot_escape_output(self):
        self.blob = self.make_zip({'../escaped': b'bad', 'image.enc': b'x', 'image.mac': b'x'})
        with self.assertRaises(RuntimeError):
            delivery.receive(self.url, self.folder)
        self.assertFalse((self.folder.parent / 'escaped').exists())

    def test_corrupt_zip_is_rejected(self):
        blob = bytearray(self.blob)
        blob[100] ^= 1
        self.blob = bytes(blob)
        with self.assertRaises(zipfile.BadZipFile):
            delivery.receive(self.url, self.folder)


if __name__ == '__main__':
    unittest.main()
