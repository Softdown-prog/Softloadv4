import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, useOutletContext } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import MarkdownRenderer from '../components/MarkdownRenderer';
import Pill from '../components/Pill';
import useFocusTrap from '../hooks/useFocusTrap';
import { drainSseFrames, parseSseJsonFrame } from '../utils/sseFrames';
import { 
    Layers, ArrowLeft, Cpu, Sparkles, Send, History, PlusCircle, 
    X, Clipboard, Check, HelpCircle, StopCircle, Eye, ArrowRight, Zap, RefreshCw
} from 'lucide-react';
import type { AppUser } from '../services/api';

type MessageRole = 'user' | 'assistant';
interface ZipFile { base64: string; nome: string; totalArquivos: number }
interface PreviewFile { xmlPath?: string; gcPath?: string; siteName?: string; colorPreset?: string; nichoTema?: string }
interface ChatMessage { role: MessageRole; content: string; zip?: ZipFile; preview?: PreviewFile; patched?: { lang?: string } }
interface ChatSession { sessionId: string; updatedAt: string; firstMessage?: string; messageCount?: number }
interface ChatHistoryResponse { sessions?: ChatSession[]; session?: { messages?: ChatMessage[] } }
interface ChatCreditsResponse { creditosGemini?: number; creditosGeminiTotal?: number }
interface ChatApiError { error?: string; erro?: string }
interface ChatStreamEvent {
    type: 'status' | 'chunk' | 'done' | 'code_patch' | 'error';
    label?: string; text?: string; reply?: string; sessionId?: string; message?: string;
    zip?: ZipFile; preview?: PreviewFile; lang?: string;
}
interface ChatCredits { creditos: number; creditosTotal: number; creditsTotal?: number }
interface WorkspaceSnapshot { manifesto?: unknown; siteName?: string; colorPreset?: string }
interface WorkspaceInfoResponse extends ChatCreditsResponse {
    redirect?: string; snapshot?: WorkspaceSnapshot | null; sessionId?: string;
    messages?: ChatMessage[];
}


export default function WorkspaceChat(): React.JSX.Element {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useOutletContext<{ user: AppUser }>();
    
    const wsSessionId = searchParams.get('wsSession');
    const wsProjetoId = searchParams.get('projeto');

    const [loadingInfo, setLoadingInfo] = useState(true);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [statusHistory, setStatusHistory] = useState<string[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [credits, setCredits] = useState<ChatCredits>({ creditos: 0, creditosTotal: 0 });
    const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
    const [sessionsList, setSessionsList] = useState<ChatSession[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [copiedId, setCopiedId] = useState<number | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingPatchRef = useRef<{ lang?: string } | null>(null);
    const drawerRef = useRef<HTMLDivElement | null>(null);

    const fecharDrawer = useCallback(() => setDrawerOpen(false), []);
    useFocusTrap(drawerRef, drawerOpen, fecharDrawer);

    // Sugestões dependendo do estado do manifesto
    const suggestionsWithManifesto = [
        "Trocar a cor principal do site",
        "Mudar a tipografia",
        "Adicionar uma seção de FAQ",
        "Que fonte eu escolhi?"
    ];

    const suggestionsWithoutManifesto = [
        "Criar um blog sobre culinária",
        "Criar um site de tecnologia e reviews",
        "Criar uma landing page de portfólio"
    ];

    useEffect(() => {
        if (!wsSessionId || !wsProjetoId) {
            iniciarChatRapido();
            return;
        }
        carregarInfoInicial();
        carregarHistorico();
    }, [wsSessionId, wsProjetoId]);

    // Entrada rápida — /dashboard/workspace/chat sem wsSession/projeto (link
    // "Novo Projeto IA" do Workspace). O backend (GET /api/workspace/chat/info
    // sem esses params) cria projeto+sessão vazios na hora e devolve pra onde
    // navegar; sessão sem snapshot já cai automaticamente no modo geração do
    // chat (chatGenerationFlow.js) — não depende de template pré-compilado.
    const iniciarChatRapido = async (): Promise<void> => {
        try {
            const res = await fetch('/api/workspace/chat/info');
            if (res.ok) {
                const data = await res.json() as WorkspaceInfoResponse;
                if (data.redirect) {
                    navigate(data.redirect, { replace: true });
                    return;
                }
            }
        } catch (err) {
            console.error('Erro ao iniciar chat do workspace:', err);
        }
        navigate('/dashboard/workspace');
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, statusText, statusHistory]);

    const carregarInfoInicial = async (): Promise<void> => {
        try {
            setLoadingInfo(true);
            const res = await fetch(`/api/workspace/chat/info?wsSession=${wsSessionId}&projeto=${wsProjetoId}`);
            if (res.ok) {
                const data = await res.json() as WorkspaceInfoResponse;
                setCredits({
                    creditos: data.creditosGemini || 0,
                    creditosTotal: data.creditosGeminiTotal || 0
                });
                setSnapshot(data.snapshot || null);
                setSessionId(data.sessionId || null);
                setMessages(data.messages || []);
            }
        } catch (err) {
            console.error('Erro ao carregar dados iniciais do chat:', err);
        } finally {
            setLoadingInfo(false);
        }
    };

    // Refresh pós-envio (créditos + snapshot) -- NUNCA reusar
    // carregarInfoInicial() aqui. Dois problemas reais que isso causava:
    // 1. carregarInfoInicial() liga `loadingInfo`, que esconde a tela
    //    inteira por trás de um spinner (`if (loadingInfo) return <spinner>`)
    //    -- toda mensagem enviada fazia o chat inteiro sumir por um instante.
    // 2. `setMessages(data.messages || [])` sobrescreve as mensagens locais
    //    (já corretas, streamadas na hora) com uma leitura do Firestore que
    //    corre em paralelo com a persistência da própria mensagem no backend
    //    (workspaceChat.js chama `res.end()` e só DEPOIS, sem `await`,
    //    dispara `chatStorage.saveSession`) -- se essa leitura vencer a
    //    corrida, ela devolve a lista de mensagens ANTIGA (sem a que acabou
    //    de ser enviada) e apaga a conversa que o usuário acabou de ver na
    //    tela. `sessionId` também não precisa ser re-buscado: já vem certo
    //    no próprio evento SSE `done` (ver handleSend).
    const atualizarCreditosSnapshot = async (): Promise<void> => {
        try {
            const res = await fetch(`/api/workspace/chat/info?wsSession=${wsSessionId}&projeto=${wsProjetoId}`);
            if (res.ok) {
                const data = await res.json() as WorkspaceInfoResponse;
                setCredits({
                    creditos: data.creditosGemini || 0,
                    creditosTotal: data.creditosGeminiTotal || 0
                });
                setSnapshot(data.snapshot || null);
            }
        } catch (err) {
            console.error('Erro ao atualizar créditos/snapshot:', err);
        }
    };

    const carregarHistorico = async (): Promise<void> => {
        try {
            const res = await fetch('/api/chat/sessions?type=workspace-chat');
            if (res.ok) {
                const data = await res.json() as ChatHistoryResponse;
                setSessionsList(data.sessions || []);
            }
        } catch (err) {
            console.error('Erro ao carregar histórico:', err);
        }
    };

    const iniciarNovaConversa = (): void => {
        if (loading) return;
        setMessages([]);
        setSessionId(null);
        setStatusHistory([]);
        setStatusText('');
        setInput('');
    };

    const carregarSessao = async (sessId: string): Promise<void> => {
        if (loading) return;
        setStatusText('Carregando conversa...');
        try {
            const res = await fetch(`/api/chat/sessions/${sessId}?type=workspace-chat`);
            if (res.ok) {
                const data = await res.json() as ChatHistoryResponse;
                if (data.session) {
                    setSessionId(sessId);
                    setMessages(data.session.messages || []);
                    setStatusHistory([]);
                    setStatusText('');
                    setDrawerOpen(false);
                }
            }
        } catch (err) {
            console.error('Erro ao carregar sessão:', err);
            setStatusText('Erro ao carregar sessão.');
        }
    };

    const handleCopy = (text: string, id: number): void => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const handleVerAlteracao = async (preview: PreviewFile | undefined): Promise<void> => {
        if (!preview || !preview.xmlPath) return;
        try {
            const res = await fetch('/api/workspace/set-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    xmlPath: preview.xmlPath,
                    gcPath: preview.gcPath || '',
                    siteName: preview.siteName || '',
                    colorPreset: preview.colorPreset || '',
                    nichoTema: preview.nichoTema || ''
                })
            });
            if (res.ok) {
                window.open('/dashboard/preview/session', '_blank');
            } else {
                alert('Não foi possível carregar o preview.');
            }
        } catch (err) {
            console.error(err);
            alert('Falha de conexão ao gerar preview.');
        }
    };

    const handleSend = async (e?: React.FormEvent<HTMLFormElement> | null, textToSend: string | null = null): Promise<void> => {
        if (e) e.preventDefault();
        const msg = (textToSend || input).trim();
        if (!msg || loading) return;
        pendingPatchRef.current = null;

        setInput('');
        setLoading(true);
        setStatusHistory([]);
        setStatusText('Iniciando conexão...');

        const updatedHistory: ChatMessage[] = [...messages, { role: 'user', content: msg }];
        setMessages(updatedHistory);

        const requestId = crypto.randomUUID(); // identificador estável deste envio HTTP
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const historyToSend = updatedHistory.slice(0, -1).slice(-20);

            const response = await fetch('/dashboard/workspace/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: msg,
                    history: historyToSend,
                    sessionId: sessionId,
                    wsSessionId: wsSessionId,
                    wsProjetoId: wsProjetoId,
                    requestId
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                if (response.status === 402) {
                    const err402 = await response.json().catch(() => ({})) as ChatApiError;
                    throw new Error(err402.error || err402.erro || 'Seus créditos de IA acabaram.');
                }
                const err = await response.json().catch(() => ({})) as ChatApiError;
                throw new Error(err.error || err.erro || 'Erro ao processar mensagem.');
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('Resposta do chat sem stream.');
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let currentAssistantReply = '';
            let addedAssistantBubble = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const batch = drainSseFrames(buffer);
                buffer = batch.remainder;
                for (const frame of batch.frames) {
                    const event = parseSseJsonFrame<ChatStreamEvent>(frame);
                    if (!event) continue;

                    if (event.type === 'status') {
                        setStatusText(event.label ?? '');
                        setStatusHistory(prev => [...prev, event.label ?? '']);
                    } else if (event.type === 'chunk') {
                        setStatusText('');
                        currentAssistantReply += event.text ?? '';

                        let visibleText = currentAssistantReply;
                        const markerIdx = currentAssistantReply.indexOf('[[TEMPLATE:');
                        if (markerIdx !== -1) {
                            visibleText = currentAssistantReply.slice(0, markerIdx).trimEnd();
                        }

                        if (!addedAssistantBubble) {
                            setMessages(prev => [...prev, { role: 'assistant', content: visibleText }]);
                            addedAssistantBubble = true;
                        } else {
                            setMessages(prev => {
                                const copy = [...prev];
                                copy[copy.length - 1] = { role: 'assistant', content: visibleText };
                                return copy;
                            });
                        }
                    } else if (event.type === 'done') {
                        setStatusText('');
                        const finalReply = event.reply || currentAssistantReply;
                        
                        let cleanedReply = finalReply;
                        const markerIdx = finalReply.indexOf('[[TEMPLATE:');
                        if (markerIdx !== -1) {
                            cleanedReply = finalReply.slice(0, markerIdx).trimEnd();
                        }

                        if (event.sessionId) {
                            setSessionId(event.sessionId);
                        }

                        const assistantMsg: ChatMessage = { role: 'assistant', content: cleanedReply };
                        if (event.preview) {
                            assistantMsg.preview = event.preview;
                        }
                        if (pendingPatchRef.current) {
                            assistantMsg.patched = { lang: pendingPatchRef.current.lang };
                            pendingPatchRef.current = null;
                        }

                        setMessages(prev => {
                            const copy = [...prev];
                            if (addedAssistantBubble) {
                                copy[copy.length - 1] = assistantMsg;
                            } else {
                                copy.push(assistantMsg);
                            }
                            return copy;
                        });

                        // Recarregar infos para pegar novos créditos e snapshot atualizado
                        // -- NUNCA carregarInfoInicial() aqui, ver comentário na declaração
                        // de atualizarCreditosSnapshot().
                        atualizarCreditosSnapshot();
                        carregarHistorico();
                    } else if (event.type === 'code_patch') {
                        pendingPatchRef.current = event;
                    } else if (event.type === 'error') {
                        setStatusText('');
                        throw new Error(event.message || 'Erro inesperado do modelo.');
                    }
                }
            }

        } catch (err) {
            // Cancelar é uma ação normal; não criar bolha de erro para AbortError.
            if (controller.signal.aborted) return;
            console.error('Streaming error:', err);
            const errMsg = err instanceof Error ? err.message : 'Falha na conexão.';
            setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Erro: ${errMsg}` }]);
        } finally {
            setLoading(false);
            setStatusText('');
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
        }
    };

    const stopGeneration = (): void => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            // Aguarda o finally do request antes de liberar um novo envio.
            setStatusText('Geração interrompida.');
        }
    };

    const suggestions = snapshot?.manifesto ? suggestionsWithManifesto : suggestionsWithoutManifesto;

    if (loadingInfo) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center bg-dark text-light" style={{ height: 'calc(100vh - 64px)' }}>
                <RefreshCw size={32} className="text-info animate-spin mb-3" />
                <p className="small text-secondary">Iniciando Editor do Workspace...</p>
            </div>
        );
    }

    return (
        <div className="sl-conversation d-flex flex-column">
            {/* Topbar */}
            <div className="sl-conversation__header d-flex align-items-center justify-content-between gap-2 p-2 p-md-3 border-bottom flex-shrink-0 flex-wrap">
                <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                    <button
                        onClick={() => navigate('/dashboard/workspace')}
                        className="btn btn-outline-secondary btn-sm p-2 d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: '38px', height: '38px' }}
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div style={{ minWidth: 0 }}>
                        <h1 className="fw-bolder text-uppercase mb-0 d-flex align-items-center gap-2" style={{ fontSize: '1rem', letterSpacing: '-0.02em', minWidth: 0 }}>
                            <span className="text-truncate" style={{ minWidth: 0 }}>Editor do Workspace</span>
                            <Pill tone="primary" className="flex-shrink-0">IA</Pill>
                        </h1>
                        <p className="mb-0 text-secondary d-none d-md-flex align-items-center gap-1" style={{ fontSize: '0.72rem' }}>
                            <Layers size={11} className="text-info flex-shrink-0" />
                            Template: <strong className="text-light">{snapshot?.siteName || 'Sem nome ainda'}</strong>
                            <span className="text-muted">·</span>
                            <span className="text-info">{snapshot?.colorPreset || 'tech-blue'}</span>
                            <span className="text-muted">·</span>
                            <span>{snapshot?.manifesto ? 'Carregado' : 'Aguardando geração'}</span>
                        </p>
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    {/* Exibição de créditos — sempre visível (era d-none d-sm-flex,
                        sumia por completo abaixo de 576px) */}
                    <div className="d-flex align-items-center gap-1 text-secondary px-2 py-1 rounded border border-secondary bg-black" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                        <Zap size={11} className="text-warning" />
                        <span>{credits.creditos.toLocaleString('pt-BR')}</span>
                        <span className="text-muted d-none d-sm-inline">/</span>
                        <span className="text-muted d-none d-sm-inline">{credits.creditosTotal.toLocaleString('pt-BR')}</span>
                    </div>

                    <button
                        onClick={() => setDrawerOpen(true)}
                        aria-label="Histórico"
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 px-3"
                    >
                        <History size={14} />
                        <span className="d-none d-md-inline">Histórico</span>
                    </button>

                    <button
                        onClick={iniciarNovaConversa}
                        disabled={loading}
                        aria-label="Nova conversa"
                        className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 px-3"
                    >
                        <PlusCircle size={14} />
                        <span className="d-none d-md-inline">Nova Conversa</span>
                    </button>
                </div>
            </div>

            {/* Corpo de Mensagens */}
            <div className="sl-conversation__feed flex-grow-1 p-3 p-md-4">
                <div className="sl-conversation__content d-flex flex-column gap-4 pb-4">
                    {messages.length === 0 ? (
                        <div className="sl-conversation__welcome d-flex flex-column align-items-center justify-content-center text-center py-5">
                            <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="sl-conversation__welcome-icon rounded-4 d-flex align-items-center justify-content-center mb-3"
                                style={{ 
                                    width: '56px', 
                                    height: '56px', 
                                    background: 'linear-gradient(135deg, rgba(14,165,233,.15), rgba(37,99,235,.15))',
                                    border: '1px solid rgba(14,165,233,.2)'
                                }}
                            >
                                <Layers size={24} className="text-info" />
                            </motion.div>
                            <h2 className="fw-black mb-2" style={{ fontSize: '1.25rem' }}>
                                {snapshot?.manifesto ? 'O que você quer mudar?' : 'Vamos criar seu template'}
                            </h2>
                            <p className="text-secondary small mb-4" style={{ maxWidth: '420px', lineHeight: 1.6 }}>
                                {snapshot?.manifesto 
                                    ? 'Este chat edita o template que você já tem carregado. Altere cores, fontes, textos, seções ou adicione FAQs.' 
                                    : 'Descreva o site que deseja criar (nicho, nome, estilo) e eu irei estruturar o arquivo XML completo para você.'
                                }
                            </p>
                            
                            <div className="d-flex flex-column gap-2 w-100" style={{ maxWidth: '420px' }}>
                                {suggestions.map((s, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => handleSend(null, s)}
                                        className="sl-conversation__suggestion btn btn-outline-secondary btn-sm text-start py-2 px-3 d-flex align-items-center justify-content-between"
                                        style={{ minWidth: 0 }}
                                    >
                                        <span className="small text-truncate">{s}</span>
                                        <ArrowRight size={12} className="text-muted" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((m, idx) => {
                            const isAssistant = m.role === 'assistant';
                            return (
                                <motion.div 
                                    key={idx}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`sl-conversation__message d-flex flex-column ${isAssistant ? 'align-items-start' : 'align-items-end'}`}
                                >
                                    <div className="sl-conversation__who small mb-2"><span className={isAssistant ? "sl-conversation__avatar sl-conversation__avatar--assistant" : "sl-conversation__avatar sl-conversation__avatar--user"} aria-hidden="true">{isAssistant ? <Layers size={15} /> : "EU"}</span><span>{isAssistant ? "Arquiteto IA" : "Você"}</span></div>
                                    <div
                                        className={`sl-conversation__bubble ${isAssistant ? 'sl-conversation__bubble--assistant' : 'sl-conversation__bubble--user'}`}
                                        
                                    >
                                        {isAssistant ? (
                                            <div className="markdown-body">
                                                <MarkdownRenderer>{m.content}</MarkdownRenderer>
                                            </div>
                                        ) : (
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                                        )}
                                    </div>

                                    {/* Badge de código corrigido automaticamente pelo validador —
                                        equivalente ao evento SSE code_patch, antes silenciosamente
                                        ignorado pelo loop de streaming. */}
                                    {isAssistant && m.patched && (
                                        <div className="d-inline-flex align-items-center gap-1 mt-1 px-1" style={{ fontSize: '0.68rem', color: '#4ade80' }}>
                                            <Check size={12} />
                                            <span>Código corrigido automaticamente{m.patched.lang ? ` (${m.patched.lang})` : ''}</span>
                                        </div>
                                    )}

                                    {/* Botões extras sob a resposta do assistente */}
                                    {isAssistant && (
                                        <div className="d-flex align-items-center gap-3 mt-1 px-1">
                                            <button
                                                onClick={() => handleCopy(m.content, idx)}
                                                className="sl-conversation__copy d-flex align-items-center gap-1"
                                                style={{ fontSize: '0.68rem', textDecoration: 'none' }}
                                            >
                                                {copiedId === idx ? (
                                                    <>
                                                        <Check size={11} className="text-success" />
                                                        <span>Copiado!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Clipboard size={11} />
                                                        <span>Copiar</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}

                                    {/* Ver Alteração Aplicada — anexado à mensagem que gerou a edição, não
                                        a um estado global, pra continuar acessível mesmo depois de novas
                                        mensagens/edições na mesma conversa. */}
                                    {isAssistant && m.preview && (
                                        <motion.div
                                            initial={{ scale: 0.95, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="p-3 rounded-3 border border-info bg-info bg-opacity-10 d-flex align-items-center justify-content-between gap-2 mt-2 flex-wrap"
                                            style={{ maxWidth: '90%', width: '100%' }}
                                        >
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <Eye size={18} className="text-info flex-shrink-0" />
                                                <div style={{ minWidth: 0 }}>
                                                    <h6 className="fw-bold mb-0 small text-truncate">Alteração Aplicada!</h6>
                                                    <span className="text-secondary" style={{ fontSize: '0.68rem' }}>
                                                        O código foi sincronizado com o sandbox.
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleVerAlteracao(m.preview)}
                                                className="btn btn-outline-info btn-sm px-3 fw-bold small flex-shrink-0"
                                            >
                                                Ver Demo Live
                                            </button>
                                        </motion.div>
                                    )}
                                </motion.div>
                            );
                        })
                    )}

                    {/* Status de carregamento */}
                    {statusText && (
                        <div role="status" aria-live="polite" className="sl-conversation__status d-flex align-items-center gap-2 small">
                            <RefreshCw size={13} className="text-info animate-spin" />
                            <span>{statusText}</span>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Form */}
            <div className="sl-conversation__composer p-3 flex-shrink-0">
                <div className="sl-conversation__composer-inner">
                    <form onSubmit={handleSend} className="d-flex gap-2">
                        <div className="flex-grow-1 position-relative">
                            <textarea 
                                className="sl-conversation__input form-control pe-5 py-2"
                                rows={1}
                                placeholder="Descreva as alterações..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                style={{
                                    resize: 'none',
                                    minHeight: '52px',
                                    maxHeight: '168px',
                                    borderRadius: '16px',
                                    lineHeight: '1.5'
                                }}
                                disabled={loading}
                            />
                            {loading ? (
                                <button 
                                    type="button"
                                    onClick={stopGeneration}
                                    className="sl-conversation__send sl-conversation__send--stop"
                                    title="Interromper geração"
                                >
                                    <StopCircle size={18} />
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!input.trim()}
                                    aria-label="Enviar mensagem"
                                    className="sl-conversation__send"
                                >
                                    <Send size={18} />
                                </button>
                            )}
                        </div>
                    </form>
                    {/* Dica de atalhos de teclado — só faz sentido com teclado físico (desktop) */}
                    <div className="d-none d-md-flex align-items-center justify-content-between mt-2 px-1 text-secondary" style={{ fontSize: '0.65rem' }}>
                        <span>Aperte <kbd className="bg-secondary bg-opacity-20 px-1 py-0.5 rounded">Enter</kbd> para enviar, <kbd className="bg-secondary bg-opacity-20 px-1 py-0.5 rounded">Shift + Enter</kbd> para nova linha.</span>
                        <span className="d-flex align-items-center gap-1">
                            <HelpCircle size={10} />
                            As modificações são compiladas no histórico de versões automaticamente.
                        </span>
                    </div>
                </div>
            </div>

            {/* Histórico Drawer */}
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
                            aria-labelledby="workspace-chat-historico-titulo"
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'tween', duration: 0.25 }}
                            className="position-fixed top-0 bottom-0 start-0 bg-dark border-end border-secondary"
                            style={{ width: 'min(340px, 90vw)', zIndex: 1050, boxShadow: '4px 0 24px rgba(0,0,0,0.3)' }}
                        >
                            <div className="d-flex align-items-center justify-content-between p-3 border-bottom border-secondary bg-black">
                                <div className="d-flex align-items-center gap-2 text-info">
                                    <History size={16} />
                                    <h5 id="workspace-chat-historico-titulo" className="mb-0 fw-black text-uppercase small" style={{ letterSpacing: '0.05em' }}>Histórico</h5>
                                </div>
                                <button
                                    onClick={() => setDrawerOpen(false)}
                                    aria-label="Fechar histórico"
                                    className="btn btn-link text-secondary p-1"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-2" style={{ overflowY: 'auto', height: 'calc(100% - 56px)' }}>
                                {sessionsList.length === 0 ? (
                                    <p className="text-secondary small text-center py-4">Nenhuma conversa salva.</p>
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
                                                className={`p-3 rounded mb-1 border cursor-pointer d-flex justify-content-between align-items-start transition-colors ${
                                                    sessionId === s.sessionId
                                                        ? 'bg-primary bg-opacity-10 border-primary text-light'
                                                        : 'bg-transparent border-transparent text-secondary hover:bg-secondary hover:bg-opacity-5'
                                                }`}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className="min-w-0 flex-grow-1">
                                                    <div className="text-truncate small fw-bold text-light mb-1">
                                                        {s.firstMessage || '(conversa vazia)'}
                                                    </div>
                                                    <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.68rem' }}>
                                                        <span>{dateStr}</span>
                                                        <span>·</span>
                                                        <span>{s.messageCount || 0} msgs</span>
                                                    </div>
                                                </div>
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
