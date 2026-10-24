"""Cache TTL simples; use armazenamento distribuído para múltiplas réplicas."""
from time import monotonic

class TtlCache:
    def __init__(self, ttl_seconds: float, clock=monotonic):
        if isinstance(ttl_seconds, bool) or ttl_seconds <= 0:
            raise ValueError("ttl_seconds deve ser positivo")
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._items = {}

    def set(self, key, value):
        self._items[key] = (self.clock() + self.ttl_seconds, value)

    def get(self, key, default=None):
        item = self._items.get(key)
        if item is None:
            return default
        expires_at, value = item
        if self.clock() >= expires_at:
            del self._items[key]
            return default
        return value
