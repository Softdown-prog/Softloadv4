"""Testes da base de códigos originais do Solaris."""
import importlib.util
import pathlib
import unittest

BASE = pathlib.Path(__file__).parent

def load(filename):
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_"), BASE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class CodeExamplesTests(unittest.TestCase):
    def test_batches_respects_size_and_order(self):
        batches = load("lotes-iteraveis.py").batches
        self.assertEqual(list(batches(list(range(8)), 3)), [[0, 1, 2], [3, 4, 5], [6, 7]])
        self.assertEqual(list(batches([], 3)), [])
        with self.assertRaises(ValueError):
            list(batches([1], 0))
        with self.assertRaises(ValueError):
            list(batches([1], True))

    def test_ttl_cache_expiration_uses_monotonic_clock(self):
        clock = [100.0]
        cache = load("cache-ttl.py").TtlCache(5, clock=lambda: clock[0])
        cache.set("key", 7)
        self.assertEqual(cache.get("key"), 7)
        clock[0] = 104.99
        self.assertEqual(cache.get("key"), 7)
        clock[0] = 105
        self.assertIsNone(cache.get("key"))
        self.assertEqual(cache.get("missing", 42), 42)
        with self.assertRaises(ValueError):
            load("cache-ttl.py").TtlCache(0)

if __name__ == "__main__":
    unittest.main()
