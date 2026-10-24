// Receita original: falhas previsíveis retornam valor tipado.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function parseJsonAs<T>(
  text: string,
  guard: (value: unknown) => value is T,
): Result<T, string> {
  if (typeof text !== 'string') return { ok: false, error: 'Entrada precisa ser texto' };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!guard(parsed)) return { ok: false, error: 'Formato inesperado' };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: 'JSON inválido' };
  }
}
