"""Gerador de lotes de listas e outras sequências indexáveis."""
from collections.abc import Iterator, Sequence
from typing import TypeVar

T = TypeVar("T")

def batches(items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    """Produz blocos de no máximo size elementos, na ordem original."""
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise ValueError("size deve ser inteiro positivo")
    for start in range(0, len(items), size):
        yield items[start:start + size]
