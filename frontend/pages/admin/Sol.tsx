import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import useFocusTrap from '../../hooks/useFocusTrap';
import {
    Send, Sun, History, PlusCircle, Trash2, X,
    FileCode, RefreshCw, StopCircle
} from 'lucide-react';
type SolRole = 'assistant' | 'user';
interface SolMessage { role: SolRole; content: string; arquivos?: string[] }
interface SolSession { sessionId: string; updatedAt: string; firstMessage?: string; messageCount?: number }
interface SolSessionResponse { session?: { messages?: SolMessage[] }; sessions?: SolSession[] }
interface SolStreamEvent {
    type: 'status' | 'chunk' | 'done' | 'error';
    label?: string; text?: string; resposta?: string; sessionId?: string; message?: string;
    budget?: { ficheirosCarregados?: string[] };
}
interface SolApiError { erro?: string }

export default function Sol(): React.JSX.Element {
    const [messages, setMessages] = useState<SolMessage[]>([
        { role: 'assistant', content: 'Oi! Sou o Sol. Pergunte sobre a arquitetura da Softload, peça pra eu ler um arquivo específico, ou peça sugestão sobre algum trecho de código.' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [sessionsList, setSessionsList] = useState<SolSession[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const drawerRef = useRef<HTMLDivElement | null>(null);

    const fecharDrawer = useCallback(() => setDrawerOpen(false), []);
    useFocusTrap(drawerRef, drawerOpen, fecharDrawer);

    useEffect(() => {
        carregarHistorico();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, statusText]);

    const carregarHistorico = async (): Promise<void> => {
        try {
            const res = await fetch('/eu/api/sol/sessions');
            if (res.ok) {
                const data = await res.json() as SolSessionResponse;
                setSessionsList(data.sessions || []);
            }
        } catch (err) {
            console.error('Erro ao carregar histórico do Sol:', err);
        }
    };

    const iniciarNovaConversa = (): void => {
        if (loading) return;
        setMessages([{ role: 'assistant', content: 'Nova conversa. Pode perguntar.' }]);
        setSessionId(null);
        setStatusText('');
        setInput('');
    };

    const carregarSessao = async (sessId: string): Promise<void> => {
        if (loading) return;
        try {
            const res = await fetch(`/eu/api/sol/sessions/${sessId}`);
            if (res.ok) {
                const data = await res.json() as SolSessionResponse;
                if (data.session) {
                    setSessionId(sessId);
                    setMessages((data.session.messages || []).filter(m => m.role === 'user' || m.role === 'assistant'));
                    setDrawerOpen(false);
                }
            }
        } catch (err) {
            console.error('Erro ao carregar conversa do Sol:', err);
        }
    };

    const excluirSessao = async (e: React.MouseEvent<HTMLButtonElement>, sessId: string): Promise<void> => {
        e.stopPropagation();
        if (confirm('Deseja realmente excluir esta conversa?')) {
            try {
                const res = await fetch(`/eu/api/sol/sessions/${sessId}`, { method: 'DELETE' });
                if (res.ok) {
                    if (sessionId === sessId) iniciarNovaConversa();
                    carregarHistorico();
                }
            } catch (err) {
                console.error('Erro ao excluir conversa do Sol:', err);
            }
        }
    };

    const handleSend = async (e?: React.FormEvent<HTMLFormElement>): Promise<void> => {
        if (e) e.preventDefault();
        const msg = input.trim();
        if (!msg || loading) return;

        setInput('');
        setLoading(true);
        setStatusText('Sol está pensando...');

        const historicoParaEnviar = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content }));

        setMessages(prev => [...prev, { role: 'user', content: msg }]);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const response = await fetch('/eu/api/sol/perguntar/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensagem: msg, historico: historicoParaEnviar, sessionId }),
                signal: controller.signal
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({})) as SolApiError;
                throw new Error(err.erro || 'Erro ao perguntar ao Sol.');
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('Resposta do Sol sem stream.');
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let respostaFinal: string | null = null;
            let erroFinal: string | null = null;
            let arquivosLidos: string[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                let idx;
                while ((idx = buffer.indexOf('\n\n')) !== -1) {
                    const block = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);

                    const dLine = block.match(/^data: (.+)$/m);
                    if (!dLine) continue;

                    let event: SolStreamEvent;
                    try {
                        event = JSON.parse(dLine[1]) as SolStreamEvent;
                    } catch (_) {
                        continue;
                    }

                    if (event.type === 'status') {
                        setStatusText(event.label || '');
                    } else if (event.type === 'chunk') {
                        respostaFinal = event.text ?? null;
                    } else if (event.type === 'done') {
                        respostaFinal = event.resposta ?? null;
                        arquivosLidos = event.budget?.ficheirosCarregados || [];
                        if (event.sessionId) setSessionId(event.sessionId);
                    } else if (event.type === 'error') {
                        erroFinal = event.message ?? null;
                    }
                }
            }

            setStatusText('');

            if (erroFinal) {
                setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Erro: ${erroFinal}` }]);
            } else if (respostaFinal) {
                setMessages(prev => [...prev, { role: 'assistant', content: respostaFinal, arquivos: arquivosLidos }]);
                carregarHistorico();
            } else {
                setMessages(prev => [...prev, { role: 'assistant', content: '[SOL] Sem resposta.' }]);
            }
        } catch (err) {
            console.error('Erro no chat do Sol:', err);
            const errMsg = err instanceof Error ? err.message : 'Falha na conexão.';
            setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Erro: ${errMsg}` }]);
        } finally {
            setLoading(false);
            setStatusText('');
            abortControllerRef.current = null;
        }
    };

    const stopGeneration = (): void => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setLoading(false);
            setStatusText('Geração interrompida.');
        }
    };

    return (
        <div className="d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
            {/* Topbar do chat */}
            <div className="d-flex align-items-center justify-content-between gap-2 p-3 border-bottom border-secondary bg-dark flex-shrink-0 flex-wrap">
                <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                         style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #fbbf24, #f97316)' }}>
                        <Sun size={20} color="#051108" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <h1 className="fw-bolder text-uppercase mb-0 text-truncate" style={{ fontSize: '1.05rem', letterSpacing: '-0.02em' }}>Sol</h1>
                        <p className="mb-0 text-secondary d-none d-md-block text-truncate" style={{ fontSize: '0.75rem' }}>
                            Lê o código da Softload sob demanda · Gemini · só consultivo, nunca executa ação
                        </p>
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    <button onClick={() => setDrawerOpen(true)} aria-label="Conversas" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 px-3">
                        <History size={14} />
                        <span className="d-none d-md-inline">Conversas</span>
                    </button>
                    <button onClick={iniciarNovaConversa} disabled={loading} aria-label="Nova conversa" className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1 px-3">
                        <PlusCircle size={14} />
                        <span className="d-none d-md-inline">Nova Conversa</span>
                    </button>
                </div>
            </div>

            {/* Corpo de mensagens */}
            <div className="flex-grow-1 p-3 p-md-4 bg-dark bg-opacity-20" style={{ overflowY: 'auto' }}>
                <div className="max-w-3xl mx-auto d-flex flex-column gap-4 pb-4">
                    {messages.map((m, idx) => {
                        const isAssistant = m.role === 'assistant';
                        return (
                            <motion.div
                                key={idx}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`d-flex flex-column ${isAssistant ? 'align-items-start' : 'align-items-end'}`}
                            >
                                <div className="small text-secondary mb-1 px-1">{isAssistant ? 'Sol' : 'Você'}</div>
                                <div
                                    className={isAssistant ? 'text-light w-100' : 'p-3 rounded-3 btn-sl-primary text-white'}
                                    style={isAssistant ? {} : { maxWidth: '90%' }}
                                >
                                    {isAssistant ? (
                                        <div className="markdown-body">
                                            <MarkdownRenderer>{m.content}</MarkdownRenderer>
                                        </div>
                                    ) : (
                                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                                    )}
                                </div>

                                {isAssistant && m.arquivos && m.arquivos.length > 0 && (
                                    <div className="d-flex align-items-center gap-1 flex-wrap mt-1 px-1" style={{ fontSize: '0.68rem', color: 'var(--sl-text-500, #94a3b8)' }}>
                                        <FileCode size={11} />
                                        <span>leu:</span>
                                        {m.arquivos.map((a, i) => (
                                            <span key={i} className="px-1 rounded border border-secondary" style={{ fontFamily: 'monospace', fontSize: '0.66rem' }}>{a}</span>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}

                    {statusText && (
                        <div className="d-flex align-items-center gap-2 text-secondary px-2 py-1 self-start small bg-dark rounded border border-secondary">
                            <RefreshCw size={13} className="text-warning animate-spin" />
                            <span>{statusText}</span>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="p-3 bg-dark border-top border-secondary flex-shrink-0">
                <div className="max-w-3xl mx-auto">
                    <form onSubmit={handleSend} className="d-flex gap-2">
                        <div className="flex-grow-1 position-relative">
                            <textarea
                                className="form-control bg-black text-light border-secondary pe-5 py-2"
                                rows={1}
                                placeholder="Pergunte algo pro Sol... (Enter envia, Shift+Enter quebra linha)"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                style={{ resize: 'none', height: '52px', minHeight: '52px', borderRadius: '8px', lineHeight: '1.5' }}
                                disabled={loading}
                            />
                            {loading ? (
                                <button type="button" onClick={stopGeneration} className="btn btn-link text-danger position-absolute end-0 top-50 translate-middle-y me-2 p-1" title="Interromper geração">
                                    <StopCircle size={18} />
                                </button>
                            ) : (
                                <button type="submit" disabled={!input.trim()} aria-label="Enviar mensagem" className="btn btn-link position-absolute end-0 top-50 translate-middle-y me-2 p-1" style={{ color: '#fbbf24' }}>
                                    <Send size={18} />
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </div>

            {/* Drawer de conversas salvas */}
            <AnimatePresence>
                {drawerOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setDrawerOpen(false)}
                            className="position-fixed inset-0 bg-black bg-opacity-50"
                            style={{ zIndex: 1040 }}
                        />
                        <motion.div
                            ref={drawerRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="sol-historico-titulo"
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'tween', duration: 0.25 }}
                            className="position-fixed top-0 bottom-0 start-0 bg-dark border-end border-secondary"
                            style={{ width: 'min(340px, 90vw)', zIndex: 1050, boxShadow: '4px 0 24px rgba(0,0,0,0.3)' }}
                        >
                            <div className="d-flex align-items-center justify-content-between p-3 border-bottom border-secondary bg-black">
                                <div className="d-flex align-items-center gap-2" style={{ color: '#fbbf24' }}>
                                    <History size={16} />
                                    <h5 id="sol-historico-titulo" className="mb-0 fw-black text-uppercase small" style={{ letterSpacing: '0.05em' }}>Conversas com o Sol</h5>
                                </div>
                                <button onClick={() => setDrawerOpen(false)} aria-label="Fechar histórico" className="btn btn-link text-secondary p-1">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-2" style={{ overflowY: 'auto', height: 'calc(100% - 56px)' }}>
                                {sessionsList.length === 0 ? (
                                    <p className="text-secondary small text-center py-4">Nenhuma conversa salva ainda.</p>
                                ) : (
                                    sessionsList.map((s) => {
                                        const date = new Date(s.updatedAt);
                                        const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) +
                                                        ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                        return (
                                            <div
                                                key={s.sessionId}
                                                onClick={() => carregarSessao(s.sessionId)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); carregarSessao(s.sessionId); } }}
                                                className={`p-3 rounded mb-1 border d-flex justify-content-between align-items-start ${
                                                    sessionId === s.sessionId
                                                        ? 'bg-warning bg-opacity-10 border-warning text-light'
                                                        : 'bg-transparent border-transparent text-secondary'
                                                }`}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className="min-w-0 flex-grow-1">
                                                    <div className="text-truncate small fw-bold text-light mb-1">
                                                        {s.firstMessage || '(sem mensagem)'}
                                                    </div>
                                                    <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.68rem' }}>
                                                        <span>{dateStr}</span>
                                                        <span>·</span>
                                                        <span>{s.messageCount || 0} msgs</span>
                                                    </div>
                                                </div>
                                                <button onClick={(e) => excluirSessao(e, s.sessionId)} className="btn btn-link text-danger p-1 ms-2" title="Excluir conversa">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
