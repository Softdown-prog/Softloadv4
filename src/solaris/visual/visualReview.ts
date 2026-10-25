/** Análise visual sob demanda: screenshot isolado -> Gemini Flash -> cobrança.
 * Nunca expõe PNG/Base64 no HTTP público e nunca faz captura implícita no chat.
 */
import { randomUUID } from 'node:crypto';

interface ScreenshotVisual {
    mimeType: string;
    dataBase64: string;
    bytes: number;
    fullPage: boolean;
}
interface CapturaVisual {
    success: boolean;
    screenshot?: ScreenshotVisual | null;
    errors?: Array<{ message: string }>;
}
interface RouterVisual {
    executarAuditoriaVisual(input: { screenshot: ScreenshotVisual }): Promise<{
        texto: string;
        tokens: { input: number; output: number; total: number };
    }>;
}
export interface RequisicaoVisual {
    body?: { url?: unknown; device?: unknown };
    session?: { user?: { email?: string } };
}
export interface RespostaVisual {
    status(code: number): RespostaVisual;
    json(body: unknown): unknown;
}
export interface DependenciasVisual {
    enabled: boolean;
    origins: string;
    capturar(input: { url: string; device: 'desktop' | 'android-mobile' }): Promise<CapturaVisual>;
    criarRouter(req: RequisicaoVisual): RouterVisual;
    debitarCreditos(email: string, input: number, output: number, operacaoId: string): Promise<unknown>;
}

const MAX_PNG_BYTES = 512 * 1024;

export function validarAlvoVisual(raw: unknown, originsCsv: string): string {
    if (typeof raw !== 'string' || raw.length > 2048 || !raw.trim()) {
        throw new Error('URL de prévia inválida.');
    }
    let url: URL;
    try { url = new URL(raw); }
    catch { throw new Error('URL de prévia inválida.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
        throw new Error('URL de prévia não permitida.');
    }
    // Origens são definidas pelo OPERADOR, não pelo usuário. Requer
    // correspondência exata (protocolo + host + porta), sem wildcard.
    const allowed = originsCsv.split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.length || !allowed.includes(url.origin)) {
        throw new Error('Origem de prévia não autorizada.');
    }
    return url.toString();
}

function validarPng(screenshot: ScreenshotVisual | null | undefined): ScreenshotVisual {
    if (!screenshot || screenshot.mimeType !== 'image/png' ||
        !Number.isSafeInteger(screenshot.bytes) || screenshot.bytes <= 0 ||
        screenshot.bytes > MAX_PNG_BYTES ||
        typeof screenshot.dataBase64 !== 'string' ||
        !screenshot.dataBase64.startsWith('iVBORw0KGgo') ||
        screenshot.dataBase64.length > Math.ceil(MAX_PNG_BYTES * 4 / 3) + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshot.dataBase64) ||
        typeof screenshot.fullPage !== 'boolean') {
        throw new Error('Captura PNG indisponível ou fora do limite de 512 KiB.');
    }
    const b64 = screenshot.dataBase64;
    const actualBytes = Math.floor(b64.length * 3 / 4) -
        (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (actualBytes !== screenshot.bytes) throw new Error('PNG com tamanho divergente.');
    return screenshot;
}

export function criarHandlerVisual(deps: DependenciasVisual) {
    return async (req: RequisicaoVisual, res: RespostaVisual): Promise<unknown> => {
        if (!deps.enabled) return res.status(404).json({ error: 'visual_review_disabled' });
        const email = req.session?.user?.email;
        if (!email) return res.status(401).json({ error: 'unauthorized' });
        let url: string;
        try { url = validarAlvoVisual(req.body?.url, deps.origins); }
        catch (error) { return res.status(400).json({ error: (error as Error).message }); }
        const device = req.body?.device === undefined ? 'desktop' : req.body.device;
        if (device !== 'desktop' && device !== 'android-mobile') {
            return res.status(400).json({ error: 'Dispositivo deve ser desktop ou android-mobile.' });
        }
        try {
            const captura = await deps.capturar({ url, device });
            if (!captura?.success) {
                return res.status(502).json({ error: 'Sandbox não concluiu a captura.' });
            }
            const screenshot = validarPng(captura.screenshot);
            // Orçamento pré-reservado no cliente Gemini protegido antes de
            // enviar a imagem. Nunca copiar Base64 para logs, SSE ou Firestore.
            const resposta = await deps.criarRouter(req).executarAuditoriaVisual({ screenshot });
            if (!resposta.texto.trim()) {
                return res.status(502).json({ error: 'O modelo visual não produziu análise.' });
            }
            const tokens = resposta.tokens;
            const input = Number.isSafeInteger(tokens?.input) && tokens.input > 0 ? tokens.input : 16000;
            const output = Number.isSafeInteger(tokens?.output) && tokens.output > 0 ? tokens.output : 1024;
            await deps.debitarCreditos(email, input, output, randomUUID());
            return res.status(200).json({
                ok: true,
                analise: resposta.texto.slice(0, 8000),
                device,
                screenshot: { fullPage: screenshot.fullPage, bytes: screenshot.bytes },
                tokens: { input, output },
            });
        } catch (error) {
            // Não vazar dados da screenshot ou erros do SDK para o cliente.
            const message = (error as Error).message || '';
            if (/PNG|Captura/.test(message)) return res.status(422).json({ error: 'Captura excedeu os limites de segurança.' });
            if (/ORCAMENTO|RESERVA|PROMPT_MUITO_GRANDE/.test(message)) {
                return res.status(402).json({ error: 'Orçamento de IA insuficiente para análise visual.' });
            }
            return res.status(503).json({ error: 'Análise visual indisponível.' });
        }
    };
}
