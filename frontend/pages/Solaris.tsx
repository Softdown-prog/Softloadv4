import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import MarkdownRenderer from '../components/MarkdownRenderer';
import Pill from '../components/Pill';
import useFocusTrap from '../hooks/useFocusTrap';
import { drainSseFrames, parseSseJsonFrame } from '../utils/sseFrames';
import { 
    Cpu, Send, Sparkles, Terminal, CheckCircle2, AlertCircle, 
    Paperclip, History, PlusCircle, Trash2, X, Clipboard, Check, Camera, 
    ArrowRight, RefreshCw, FileArchive, Zap, StopCircle, HelpCircle, Wrench, GitBranch, Shapes
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
interface UploadCandidate { score: number; framework: string; evidencias: string[] }
interface VisualStatus { enabled: boolean; origins: string[]; maxRequestsPerTenMinutes: number }
interface VisualResponse { ok?: boolean; analise?: string; error?: string; tokens?: { input: number; output: number } }
interface SolarisGithubStatus {
    configured: boolean;
    connected: boolean;
    installable?: boolean;
    account: string | null;
    repository: string | null;
}
interface UploadResponse {
    ok?: boolean; sessionId?: string; framework?: string; totalArquivos?: number;
    candidatos?: UploadCandidate[]; analiseIA?: string; temProjeto?: boolean; error?: string;
}


export default function Solaris(): React.JSX.Element {
    const { user } = useOutletContext<{ user: AppUser }>();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [statusHistory, setStatusHistory] = useState<string[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [credits, setCredits] = useState<ChatCredits>({ creditos: 0, creditosTotal: 0 });
    const [sessionsList, setSessionsList] = useState<ChatSession[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [uploading, setUploading] = useState(false);
    const [visualOpen, setVisualOpen] = useState(false);
    const [visualUrl, setVisualUrl] = useState('');
    const [visualDevice, setVisualDevice] = useState<'desktop' | 'android-mobile'>('desktop');
    const [visualStatus, setVisualStatus] = useState<VisualStatus | null>(null);
    const [visualBusy, setVisualBusy] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const [activeTool, setActiveTool] = useState<'none' | 'asset-forge-2d' | 'github'>('none');
    const [githubRepository, setGithubRepository] = useState('');
    const [toolError, setToolError] = useState('');
    const [githubStatus, setGithubStatus] = useState<SolarisGithubStatus | null>(null);
    const [githubBusy, setGithubBusy] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const drawerRef = useRef<HTMLDivElement | null>(null);

    const fecharDrawer = useCallback(() => setDrawerOpen(false), []);
    useFocusTrap(drawerRef, drawerOpen, fecharDrawer);

    const carregarGithub = async (): Promise<void> => {
        try {
            const response = await fetch('/dashboard/solaris/github/status', {cache:'no-store'});
            if (!response.ok) return;
            const status = await response.json() as SolarisGithubStatus;
            setGithubStatus(status);
            if (status.repository) setGithubRepository('https://github.com/' + status.repository);
        } catch { setGithubStatus(null); }
    };
    const salvarRepositorioGithub = async (): Promise<void> => {
        if (!githubStatus?.connected) return;
        setGithubBusy(true);
        setToolError('');
        try {
            const response = await fetch('/dashboard/solaris/github/repository', {
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({repository:githubRepository.trim()}),
            });
            const data = await response.json() as {repository?:string;erro?:string};
            if (!response.ok) throw Error(data.erro || 'Não foi possível vincular o repositório.');
            if (data.repository) setGithubRepository('https://github.com/' + data.repository);
            await carregarGithub();
        } catch (e) {
            setToolError(e instanceof Error ? e.message : 'Falha ao vincular o repositório.');
        } finally { setGithubBusy(false); }
    };
    const desconectarGithub = async (): Promise<void> => {
        setGithubBusy(true);
        setToolError('');
        try {
            const response = await fetch('/dashboard/solaris/github/disconnect', {method:'DELETE'});
            if (!response.ok) throw Error('Não foi possível desconectar GitHub.');
            setGithubStatus(status => status ? {...status,connected:false,repository:null,account:null} : null);
            setGithubRepository('');
        } catch (e) { setToolError(e instanceof Error ? e.message : 'Falha ao desconectar.'); }
        finally { setGithubBusy(false); }
    };

    const suggestions = [
        "Quero criar uma landing page de SaaS",
        "Como estruturar um projeto HTML5/CSS3 do zero",
        "Revisar um trecho de JavaScript",
        "Boas práticas de CSS responsivo"
    ];

    // Carregar créditos e histórico de sessões ao montar o componente
    useEffect(() => {
        carregarCreditos();
        carregarHistorico();
        void carregarGithub();
        fetch('/dashboard/solaris/visual-review/status')
            .then(async r => r.ok ? await r.json() as VisualStatus : null)
            .then(status => setVisualStatus(status))
            .catch(() => setVisualStatus(null));
    }, []);

    // Rolar até a mensagem mais recente
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, statusText, statusHistory]);

    const carregarCreditos = async (): Promise<void> => {
        try {
            const res = await fetch('/api/chat/status');
            if (res.ok) {
                const data = await res.json() as ChatCreditsResponse;
                setCredits({
                    creditos: data.creditosGemini || 0,
                    creditosTotal: data.creditosGeminiTotal || 0
                });
            }
        } catch (err) {
            console.error('Erro ao carregar créditos:', err);
        }
    };

    const carregarHistorico = async (): Promise<void> => {
        try {
            const res = await fetch('/api/chat/sessions?type=solaris-chat');
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
            const res = await fetch(`/api/chat/sessions/${sessId}?type=solaris-chat`);
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

    const excluirSessao = async (e: React.MouseEvent<HTMLButtonElement>, sessId: string): Promise<void> => {
        e.stopPropagation();
        if (confirm('Deseja realmente excluir esta conversa?')) {
            try {
                const res = await fetch(`/api/chat/sessions/${sessId}?type=solaris-chat`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    if (sessionId === sessId) {
                        iniciarNovaConversa();
                    }
                    carregarHistorico();
                }
            } catch (err) {
                console.error('Erro ao excluir sessão:', err);
            }
        }
    };

    const handleCopy = (text: string, id: number): void => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const handleUploadClick = (): void => {
        if (loading || uploading) return;
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!/\.zip$/i.test(file.name)) {
            alert('Por favor, envie um arquivo .zip válido.');
            return;
        }

        setUploading(true);
        setStatusText('Analisando o arquivo do projeto...');
        setMessages(prev => [...prev, { role: 'user', content: `Enviei o arquivo "${file.name}" para análise.` }]);

        try {
            const formData = new FormData();
            formData.append('arquivo', file);
            if (sessionId) {
                formData.append('sessionId', sessionId);
            }

            const res = await fetch('/dashboard/solaris/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json() as UploadResponse;
            if (res.ok && data.ok !== false) {
                if (data.sessionId) setSessionId(data.sessionId);

                // Formatar o resultado do upload
                let md = '';
                if (data.framework) {
                    md += `Analisei o projeto enviado — parece ser **${data.framework.toUpperCase()}**.\n\n`;
                } else {
                    md += 'Analisei o projeto enviado, mas os sinais de framework ficaram empatados.\n\n';
                }
                md += `Total de arquivos: ${data.totalArquivos}.\n`;
                
                const candidatos = (data.candidatos || []).filter(c => c.score > 0);
                if (candidatos.length) {
                    md += '\n**Candidatos avaliados:**\n';
                    candidatos.forEach(c => {
                        md += `- ${c.framework.toUpperCase()} (score ${c.score}): ${c.evidencias.join('; ')}\n`;
                    });
                }
                if (data.analiseIA) {
                    md += `\n\n${data.analiseIA}`;
                }
                if (data.temProjeto) {
                    md += '\n\n_Pode perguntar sobre arquivos específicos do projeto daqui pra frente!_';
                }

                setMessages(prev => [...prev, { role: 'assistant', content: md }]);
                carregarHistorico();
            } else {
                setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Erro ao analisar projeto: ${data.error || 'Falha no processamento.'}` }]);
            }
        } catch (err) {
            console.error('Erro no upload:', err);
            setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Falha na conexão ao enviar o arquivo.' }]);
        } finally {
            setUploading(false);
            setStatusText('');
            e.target.value = '';
        }
    };

    const handleVisualReview = async (): Promise<void> => {
        const url = visualUrl.trim();
        if (!url || !visualStatus?.enabled || visualBusy || loading || uploading) return;
        try {
            const target = new URL(url);
            if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Endereço inválido');
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Digite uma URL HTTP ou HTTPS válida para auditar.' }]);
            return;
        }
        setVisualBusy(true);
        setStatusText('O Solaris está abrindo o site no navegador isolado e analisando o layout...');
        setMessages(prev => [...prev, { role: 'user', content: `Auditar visualmente ${url} (${visualDevice === 'desktop' ? 'desktop' : 'Android'}).` }]);
        try {
            const response = await fetch('/dashboard/solaris/visual-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, device: visualDevice }),
            });
            const data = await response.json() as VisualResponse;
            if (!response.ok || !data.ok || !data.analise) {
                const problema = data.error || (response.status === 402 ? 'Saldo insuficiente para análise visual.' : 'A auditoria não pôde ser concluída.');
                throw new Error(problema);
            }
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `**Auditoria visual — ${visualDevice === 'desktop' ? 'Desktop' : 'Android'}**\n\n${data.analise}\n\n_Imagem analisada pelo Gemini Flash. O relatório pode ser utilizado nesta conversa para pedir ajustes; nenhum código foi alterado automaticamente._`,
            }]);
            setVisualOpen(false);
            carregarCreditos();
        } catch (error) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `⚠️ A auditoria visual não foi concluída: ${error instanceof Error ? error.message : 'falha de conexão'}`,
            }]);
        } finally {
            setVisualBusy(false);
            setStatusText('');
        }
    };

    const handleSend = async (e?: React.FormEvent<HTMLFormElement> | null, textToSend: string | null = null): Promise<void> => {
        if (e) e.preventDefault();
        const msg = (textToSend || input).trim();
        if (!msg || loading || visualBusy) return;
        if (activeTool === 'github' && !/^(?:https:\/\/github\.com\/)?[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}(?:\.git)?\/?$/.test(githubRepository.trim())) {
            setToolError('Cole o link do repositório público: https://github.com/dono/repositorio');
            return;
        }
        setToolError('');
        setInput('');
        setLoading(true);
        setStatusHistory([]);
        setStatusText('Iniciando conexão...');

        // Adicionar mensagem do usuário
        const updatedHistory: ChatMessage[] = [...messages, { role: 'user', content: msg }];
        setMessages(updatedHistory);

        const requestId = crypto.randomUUID(); // identificador estável deste envio HTTP
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            // Pegar as últimas 20 mensagens do histórico para contexto seguro
            const historyToSend = updatedHistory.slice(0, -1).slice(-20);

            const response = await fetch('/dashboard/solaris/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: msg,
                    history: historyToSend,
                    sessionId: sessionId,
                    tool: activeTool,
                    ...(activeTool === 'github' ? { githubRepository: githubRepository.trim() } : {}),
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
                throw new Error(err.error || err.erro || 'Erro ao processar requisição.');
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
                        setStatusText(''); // Limpar status ao começar a transmitir texto
                        currentAssistantReply += event.text ?? '';

                        // Esconder marcador interno se houver
                        let visibleText = currentAssistantReply;
                        const markerIdx = currentAssistantReply.indexOf('[[SOLARIS_GERAR:');
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
                        
                        // Remover marcador do texto final
                        let cleanedReply = finalReply;
                        const markerIdx = finalReply.indexOf('[[SOLARIS_GERAR:');
                        if (markerIdx !== -1) {
                            cleanedReply = finalReply.slice(0, markerIdx).trimEnd();
                        }

                        if (event.sessionId) {
                            setSessionId(event.sessionId);
                        }

                        const assistantMsg: ChatMessage = { role: 'assistant', content: cleanedReply };
                        if (event.zip && event.zip.base64) {
                            assistantMsg.zip = {
                                base64: event.zip.base64,
                                nome: event.zip.nome || 'projeto-solaris.zip',
                                totalArquivos: event.zip.totalArquivos || 0
                            };
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

                        // Recarregar créditos consumidos
                        carregarCreditos();
                        carregarHistorico();
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

    return (
        <div className="d-flex flex-column" style={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
            {/* Topbar do Chat */}
            <div className="d-flex align-items-center justify-content-between gap-2 p-3 border-bottom border-secondary bg-dark flex-shrink-0 flex-wrap">
                <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center justify-content-center rounded-3 bg-opacity-10 bg-primary border border-primary flex-shrink-0" style={{ width: '40px', height: '40px' }}>
                        <Cpu size={20} className="text-info" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <h1 className="fw-bolder text-uppercase mb-0 d-flex align-items-center gap-2" style={{ fontSize: '1.05rem', letterSpacing: '-0.02em', minWidth: 0 }}>
                            <span className="text-truncate" style={{ minWidth: 0 }}>Solaris Code AI</span>
                            <Pill tone="indigo" className="flex-shrink-0">v3 IA</Pill>
                        </h1>
                        <p className="mb-0 text-secondary d-none d-md-block text-truncate" style={{ fontSize: '0.75rem' }}>Arquiteto front/back-end leve de alto desempenho.</p>
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    {/* Exibição de créditos — sempre visível (era d-none d-sm-flex,
                        sumia por completo abaixo de 576px) */}
                    <div className="d-flex align-items-center gap-1 text-secondary px-2 py-1 rounded border border-secondary bg-black" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                        <Zap size={11} className="text-warning" />
                        <span>{credits.creditos.toLocaleString('pt-BR')}</span>
                        <span className="text-muted d-none d-sm-inline">/</span>
                        <span className="text-muted d-none d-sm-inline">{credits.creditsTotal ? credits.creditsTotal.toLocaleString('pt-BR') : credits.creditosTotal.toLocaleString('pt-BR')}</span>
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
                        className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1 px-3"
                    >
                        <PlusCircle size={14} />
                        <span className="d-none d-md-inline">Nova Conversa</span>
                    </button>
                </div>
            </div>

            {/* Corpo de Mensagens */}
            <div className="flex-grow-1 p-3 p-md-4 bg-dark bg-opacity-20" style={{ overflowY: 'auto' }}>
                <div className="max-w-3xl mx-auto d-flex flex-column gap-4 pb-4">
                    {messages.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center py-5">
                            <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.3 }}
                                className="rounded-4 d-flex align-items-center justify-content-center mb-3"
                                style={{ 
                                    width: '56px', 
                                    height: '56px', 
                                    background: 'linear-gradient(135deg, rgba(99,102,241,.15), rgba(168,85,247,.15))',
                                    border: '1px solid rgba(99,102,241,.2)'
                                }}
                            >
                                <Sparkles size={24} className="text-info animate-pulse" />
                            </motion.div>
                            <h2 className="fw-black mb-2" style={{ fontSize: '1.25rem' }}>Como posso construir com você hoje?</h2>
                            <p className="text-secondary small mb-4" style={{ maxWidth: '420px', lineHeight: 1.6 }}>
                                Crie landing pages, analise códigos, estruture layouts modernos de Blogger/XML ou explore ideias inovadoras.
                            </p>
                            
                            <div className="d-flex flex-column gap-2 w-100" style={{ maxWidth: '420px' }}>
                                {suggestions.map((s, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => handleSend(null, s)}
                                        className="btn btn-outline-secondary btn-sm text-start py-2 px-3 d-flex align-items-center justify-content-between"
                                        style={{ background: 'rgba(255,255,255,0.01)', borderColor: 'rgba(255,255,255,0.08)' }}
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
                                    className={`d-flex flex-column ${isAssistant ? 'align-items-start' : 'align-items-end'}`}
                                >
                                    <div className="small text-secondary mb-1 px-1">
                                        {isAssistant ? 'Solaris Code' : 'Você'}
                                    </div>
                                    <div
                                        className={isAssistant ? 'text-light w-100' : 'p-3 rounded-3 max-w-full btn-sl-primary text-white'}
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

                                    {/* Footer da Bolha */}
                                    {isAssistant && (
                                        <div className="d-flex align-items-center gap-2 mt-1 px-1">
                                            <button
                                                onClick={() => handleCopy(m.content, idx)}
                                                className="btn btn-link text-secondary p-0 d-flex align-items-center gap-1"
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

                                    {/* Download do ZIP — anexado à mensagem que gerou o projeto, não a um
                                        estado global, pra continuar acessível mesmo depois de novas
                                        mensagens/gerações na mesma conversa. */}
                                    {isAssistant && m.zip && (
                                        <motion.div
                                            initial={{ scale: 0.95, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="p-3 rounded-3 border border-primary bg-primary bg-opacity-10 d-flex align-items-center justify-content-between gap-2 mt-2 flex-wrap"
                                            style={{ maxWidth: '90%', width: '100%' }}
                                        >
                                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                                <FileArchive size={20} className="text-info flex-shrink-0" />
                                                <div style={{ minWidth: 0 }}>
                                                    <h6 className="fw-bold mb-0 small text-truncate">{m.zip.nome}</h6>
                                                    <span className="text-secondary" style={{ fontSize: '0.68rem' }}>
                                                        {m.zip.totalArquivos} arquivos compilados com sucesso
                                                    </span>
                                                </div>
                                            </div>
                                            <a
                                                href={`data:application/zip;base64,${m.zip.base64}`}
                                                download={m.zip.nome}
                                                className="btn btn-sl-primary btn-sm px-3 fw-bold small flex-shrink-0"
                                            >
                                                Baixar ZIP
                                            </a>
                                        </motion.div>
                                    )}
                                </motion.div>
                            );
                        })
                    )}

                    {/* Loading e Etapas Ativas */}
                    {statusText && (
                        <div className="d-flex align-items-center gap-2 text-secondary px-2 py-1 self-start small bg-dark rounded border border-secondary">
                            <RefreshCw size={13} className="text-info animate-spin" />
                            <span>{statusText}</span>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input e Controles de Chat */}
            <div className="p-3 bg-dark border-top border-secondary flex-shrink-0">
                <div className="max-w-3xl mx-auto">
                    <div className="mb-2">
                        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                            <button
                                type="button"
                                className="btn btn-outline-info btn-sm d-flex align-items-center gap-2"
                                aria-expanded={toolsOpen}
                                aria-controls="solaris-tools-panel"
                                onClick={() => setToolsOpen(open => !open)}
                                disabled={loading || uploading || visualBusy}
                            >
                                <Wrench size={15} /> Ferramentas
                            </button>
                            {activeTool !== 'none' && (
                                <span className="badge rounded-pill bg-info bg-opacity-25 text-info">
                                    {activeTool === 'asset-forge-2d' ? 'Criar Assets 2D ativo' : 'GitHub (público) ativo'}
                                </span>
                            )}
                        </div>
                        {toolsOpen && (
                            <div id="solaris-tools-panel" className="rounded-3 border border-secondary p-3 mb-2 d-flex flex-column gap-2"
                                style={{ background: 'rgba(0,0,0,0.45)' }}>
                                <p className="small text-secondary mb-1">Escolha uma ferramenta para as próximas mensagens.</p>
                                <div className="d-flex flex-wrap gap-2">
                                    <button type="button" className={`btn btn-sm ${activeTool === 'asset-forge-2d' ? 'btn-info' : 'btn-outline-secondary'}`}
                                        aria-pressed={activeTool === 'asset-forge-2d'}
                                        disabled={loading || uploading}
                                        onClick={() => { setActiveTool('asset-forge-2d'); setToolError(''); }}>
                                        <Shapes size={14} className="me-1" /> Criar Assets 2D
                                    </button>
                                    <button type="button" className={`btn btn-sm ${activeTool === 'github' ? 'btn-info' : 'btn-outline-secondary'}`}
                                        aria-pressed={activeTool === 'github'}
                                        disabled={loading || uploading}
                                        onClick={() => { setActiveTool('github'); setToolError(''); }}>
                                        <GitBranch size={14} className="me-1" /> GitHub
                                    </button>
                                    <button type="button" className={`btn btn-sm ${activeTool === 'none' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                                        aria-pressed={activeTool === 'none'}
                                        onClick={() => { setActiveTool('none'); setToolError(''); }}
                                        disabled={loading || uploading}>
                                        Sem ferramenta
                                    </button>
                                </div>
                                {activeTool === 'asset-forge-2d' && (
                                    <p className="small text-secondary mb-0">
                                        Solaris usará o Asset Forge 2D para criar sprites, personagens, cenários e assets procedurais.
                                        Os arquivos renderizados serão entregues no ZIP quando a geração for executada.
                                    </p>
                                )}
                                {activeTool === 'github' && (
                                    <div className="d-flex flex-column gap-2">
                                        <label htmlFor="solaris-github-repo" className="small text-secondary">Link do repositório GitHub público</label>
                                        <input id="solaris-github-repo" type="url"
                                            className="form-control form-control-sm bg-dark text-light border-secondary"
                                            placeholder="https://github.com/dono/repositorio"
                                            value={githubRepository}
                                            maxLength={240}
                                            onChange={e => { setGithubRepository(e.target.value); setToolError(''); }}
                                            disabled={loading || uploading} />
                                        <div className="d-flex flex-wrap gap-2 align-items-center">
                                            {githubStatus?.connected ? (
                                                <>
                                                    <span className="small text-info">
                                                        <CheckCircle2 size={13} className="me-1" />
                                                        Conectado como {githubStatus.account}
                                                    </span>
                                                    {githubStatus.installable && (
                                                        <button type="button" className="btn btn-outline-secondary btn-sm"
                                                            disabled={loading || githubBusy}
                                                            onClick={() => { window.location.assign('/dashboard/solaris/github/install'); }}>
                                                            Autorizar repositórios no GitHub
                                                        </button>
                                                    )}
                                                    <button type="button" className="btn btn-outline-info btn-sm"
                                                        disabled={githubBusy || loading}
                                                        onClick={() => { void salvarRepositorioGithub(); }}>
                                                        {githubBusy ? 'Validando...' : 'Vincular repositório'}
                                                    </button>
                                                    <button type="button" className="btn btn-outline-secondary btn-sm"
                                                        disabled={githubBusy || loading}
                                                        onClick={() => { void desconectarGithub(); }}>
                                                        Desconectar
                                                    </button>
                                                </>
                                            ) : (
                                                <button type="button" className="btn btn-outline-info btn-sm"
                                                    disabled={!githubStatus?.configured || githubBusy || loading}
                                                    onClick={() => { window.location.assign('/dashboard/solaris/github/connect'); }}>
                                                    <GitBranch size={14} className="me-1" /> Conectar GitHub
                                                </button>
                                            )}
                                        </div>
                                        <p className="small text-secondary mb-0">
                                            {githubStatus?.connected
                                                ? 'Conta autorizada. Escolha o repositório permitido para receber o contexto no chat. A leitura de privados depende das permissões concedidas à GitHub App; a publicação de commits ainda não está habilitada.'
                                                : githubStatus?.configured
                                                    ? 'Na primeira conexão, o GitHub pedirá autorização à GitHub App. Depois escolha o repositório. Repositórios públicos também podem ser consultados pelo link sem login.'
                                                    : 'A conexão de contas requer configurar a GitHub App na Softload. Por enquanto, o link de um repositório público funciona para análise em modo somente leitura.'}
                                        </p>
                                    </div>
                                )}
                                {toolError && <p className="small text-warning mb-0" role="alert">{toolError}</p>}
                            </div>
                        )}
                        <button
                            type="button"
                            className="btn btn-outline-info btn-sm d-flex align-items-center gap-2"
                            aria-expanded={visualOpen}
                            onClick={() => setVisualOpen(open => !open)}
                            disabled={loading || uploading || visualBusy}
                        >
                            <Camera size={15} />
                            Auditar visualmente um site
                        </button>
                        {visualOpen && (
                            <div className="rounded-3 border border-secondary bg-black bg-opacity-50 p-3 mt-2 d-flex flex-column gap-2">
                                <label htmlFor="solaris-visual-url" className="small text-secondary">URL pública do site ou da prévia</label>
                                <input
                                    id="solaris-visual-url"
                                    type="url"
                                    maxLength={2048}
                                    className="form-control bg-dark text-light border-secondary"
                                    placeholder={visualStatus?.origins?.[0] || 'https://softload.analysepro.com/'}
                                    value={visualUrl}
                                    onChange={e => setVisualUrl(e.target.value)}
                                    disabled={visualBusy}
                                />
                                <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                    <select
                                        aria-label="Dispositivo da captura"
                                        className="form-select bg-dark text-light border-secondary w-auto"
                                        value={visualDevice}
                                        onChange={e => setVisualDevice(e.target.value as 'desktop' | 'android-mobile')}
                                        disabled={visualBusy}
                                    >
                                        <option value="desktop">Desktop</option>
                                        <option value="android-mobile">Android</option>
                                    </select>
                                    <button
                                        type="button"
                                        className="btn btn-info btn-sm fw-semibold"
                                        onClick={handleVisualReview}
                                        disabled={!visualStatus?.enabled || !visualUrl.trim() || visualBusy || loading || uploading}
                                    >
                                        {visualBusy ? 'Analisando...' : 'Auditar agora (usa créditos)'}
                                    </button>
                                </div>
                                <div className="text-secondary" style={{fontSize:'0.7rem'}}>
                                    {visualStatus === null
                                        ? 'Consultando disponibilidade do navegador de testes...'
                                        : !visualStatus.enabled
                                            ? 'Análise visual indisponível: confira a configuração do sandbox e da chave Gemini no servidor.'
                                            : `Origens autorizadas: ${visualStatus.origins.join(', ')}. Somente URLs públicas; o relatório não altera os arquivos automaticamente.`}
                                </div>
                            </div>
                        )}
                    </div>
                    <form onSubmit={handleSend} className="d-flex gap-2">
                        <button 
                            type="button"
                            onClick={handleUploadClick}
                            disabled={loading || uploading || visualBusy}
                            className="btn btn-outline-secondary d-flex align-items-center justify-content-center"
                            style={{ width: '46px', height: '46px' }}
                            title="Anexar projeto .zip"
                        >
                            <Paperclip size={18} />
                        </button>
                        <input 
                            ref={fileInputRef}
                            type="file"
                            accept=".zip"
                            hidden
                            onChange={handleFileUpload}
                        />

                        <div className="flex-grow-1 position-relative">
                            <textarea 
                                className="form-control bg-black text-light border-secondary pe-5 py-2"
                                rows={1}
                                placeholder="Fale com o Solaris..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                style={{
                                    resize: 'none',
                                    height: '52px',
                                    minHeight: '52px',
                                    borderRadius: '8px',
                                    lineHeight: '1.5'
                                }}
                                disabled={loading}
                            />
                            {loading ? (
                                <button 
                                    type="button"
                                    onClick={stopGeneration}
                                    className="btn btn-link text-danger position-absolute end-0 top-50 translate-middle-y me-2 p-1"
                                    title="Interromper geração"
                                >
                                    <StopCircle size={18} />
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!input.trim()}
                                    aria-label="Enviar mensagem"
                                    className="btn btn-link text-info position-absolute end-0 top-50 translate-middle-y me-2 p-1"
                                >
                                    <Send size={18} />
                                </button>
                            )}
                        </div>
                    </form>
                    {/* Dica de atalhos de teclado — só faz sentido com teclado físico (desktop) */}
                    <div className="d-none d-md-flex align-items-center justify-content-between mt-2 px-1 text-secondary" style={{ fontSize: '0.65rem' }}>
                        <span>Aperte <kbd className="bg-secondary bg-opacity-20 px-1 py-0.5 rounded">Enter</kbd> para enviar, <kbd className="bg-secondary bg-opacity-20 px-1 py-0.5 rounded">Shift + Enter</kbd> para pular linha.</span>
                        <span className="d-flex align-items-center gap-1">
                            <HelpCircle size={10} />
                            Solaris compila templates baseados em HTML5 limpo
                        </span>
                    </div>
                </div>
            </div>

            {/* Histórico Drawer (Collapsible) */}
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
                            aria-labelledby="solaris-historico-titulo"
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
                                    <h5 id="solaris-historico-titulo" className="mb-0 fw-black text-uppercase small" style={{ letterSpacing: '0.05em' }}>Histórico</h5>
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
                                                <button 
                                                    onClick={(e) => excluirSessao(e, s.sessionId)}
                                                    className="btn btn-link text-danger p-1 ms-2"
                                                    title="Excluir conversa"
                                                >
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
