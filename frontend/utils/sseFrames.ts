/**
 * Extrai quadros completos de Server-Sent Events de um fluxo incremental.
 * O conteúdo incompleto permanece intacto entre as chamadas, inclusive
 * quando o delimitador CRLF cruza o limite de um chunk.
 */
export interface SseFrameBatch {
    frames: string[];
    remainder: string;
}

export function drainSseFrames(buffer: string): SseFrameBatch {
    const frames: string[] = [];
    const delimiter = /\r?\n\r?\n/g;
    let start = 0;
    for (const match of buffer.matchAll(delimiter)) {
        frames.push(buffer.slice(start, match.index));
        start = match.index + match[0].length;
    }
    return { frames, remainder: buffer.slice(start) };
}

/**
 * Lê somente os campos data: (inclusive eventos SSE multilinha).
 * Comentários/heartbeats e JSON inválido não interrompem o streaming.
 */
export function parseSseJsonFrame<T extends { type: string }>(frame: string): T | null {
    const lines = frame.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''));
    if (lines.length === 0) return null;
    try {
        const value: unknown = JSON.parse(lines.join('\n'));
        if (value === null || typeof value !== 'object'
            || typeof (value as { type?: unknown }).type !== 'string') return null;
        return value as T;
    } catch {
        return null;
    }
}
