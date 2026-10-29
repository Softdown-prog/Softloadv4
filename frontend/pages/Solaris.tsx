import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import MarkdownRenderer from '../components/MarkdownRenderer';
import ChatHeaderActions from '../components/ChatHeaderActions';
import useFocusTrap from '../hooks/useFocusTrap';
import { drainSseFrames, parseSseJsonFrame } from '../utils/sseFrames';
import { extrairErroRespostaChat } from '../services/chatHttpErrors';
import { 
    Cpu, Send, Sparkles, Terminal, CheckCircle2, AlertCircle, 
    History, Plus, Trash2, X, Clipboard, Check, 
    ArrowRight, ArrowDown, RefreshCw, FileArchive, Zap, StopCircle, HelpCircle, Wrench, GitBranch, Shapes
} from 'lucide-react';
import type { AppUser } from '../services/api';
import { consultarSaldoSolaris, type SaldoSolarisVisual } from '../services/solarisCredits';

type MessageRole = 'user' | 'assistant';
interface ZipFile { base64: string; nome: string; totalArquivos: number }
interface PreviewFile { xmlPath?: string; gcPath?: string; siteName?: string; colorPreset?: string; nichoTema?: string }
interface ChatMessage { role: MessageRole; content: string; zip?: ZipFile; preview?: PreviewFile; patched?: { lang?: string } }
interface ChatSession { sessionId: string; updatedAt: string; firstMessage?: string; messageCount?: number }
interface ChatHistoryResponse { sessions?: ChatSession[]; session?: { messages?: ChatMessage[] } }
interface ChatApiError { error?: string; erro?: string }
interface ChatStreamEvent {
    type: 'status' | 'chunk' | 'done' | 'code_patch' | 'error';
    label?: string; text?: string; reply?: string; sessionId?: string; message?: string;
    zip?: ZipFile; preview?: PreviewFile; lang?: string;
}
interface ChatCredits { creditos: number; creditosTotal: number; creditsTotal?: number }
interface GithubProposal {
 state:'none'|'pending'|'applying'|'completed'|'cancelled'|'failed'|'expired';
 repository?:string; title?:string; branch?:string; expiresAt?:number;
 files?:Array<{path:string;summary:string;operation:string;proposedContent:string;currentSha:string|null}>;
 result?:{prUrl:string;prNumber:number;branch:string;commits:string[]};
}
interface SolarisGithubStatus {
    configured: boolean;
    connected: boolean;
    installable?: boolean;
    mcpEnabled?: boolean;
    account: string | null;
    repository: string | null;
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
    const [saldoFonte, setSaldoFonte] = useState<SaldoSolarisVisual['fonte']>('indisponivel');
    const [sessionsList, setSessionsList] = useState<ChatSession[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [quickMenuOpen, setQuickMenuOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const [activeTool, setActiveTool] = useState<'none' | 'asset-forge-2d' | 'github'>('none');
    const [githubRepository, setGithubRepository] = useState('');
    const [toolError, setToolError] = useState('');
    const [githubStatus, setGithubStatus] = useState<SolarisGithubStatus | null>(null);
    const [githubBusy, setGithubBusy] = useState(false);
    const [githubRepos, setGithubRepos] = useState<Array<{name:string;private:boolean;canPush:boolean}>>([]);
    const [githubReposBusy, setGithubReposBusy] = useState(false);
    const [githubReposTruncated, setGithubReposTruncated] = useState(false);
    const [githubProposal, setGithubProposal] = useState<GithubProposal>({state:'none'});
    const [githubApprovalBusy, setGithubApprovalBusy] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const chatFeedRef = useRef<HTMLDivElement | null>(null);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    // O streaming acompanha a conversa somente enquanto o leitor estiver no fim.
    const shouldFollowRef = useRef(true);
    const quickMenuRef = useRef<HTMLDivElement | null>(null);
    const quickTriggerRef = useRef<HTMLButtonElement | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const drawerRef = useRef<HTMLDivElement | null>(null);

    // Retomar a leitura no fim sem alterar a posição enquanto o usuário lê mensagens antigas.
    const scrollToLatest = (): void => {
        shouldFollowRef.current = true;
        setShowJumpToLatest(false);
        const feed = chatFeedRef.current;
        if (feed) feed.scrollTop = feed.scrollHeight;
    };

    const fecharDrawer = useCallback(() => setDrawerOpen(false), []);
    useFocusTrap(drawerRef, drawerOpen, fecharDrawer);

    // Fecha as ferramentas ao tocar fora do menu ou pressionar Escape.
    useEffect(() => {
        if (!quickMenuOpen) return;
        const closeMenu = (): void => {
            setQuickMenuOpen(false);
            setToolsOpen(false);
        };
        const onOutside = (event: PointerEvent): void => {
            if (!quickMenuRef.current?.contains(event.target as Node)) closeMenu();
        };
        const onEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                closeMenu();
                quickTriggerRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onOutside);
        document.addEventListener('keydown', onEscape);
        return () => {
            document.removeEventListener('pointerdown', onOutside);
            document.removeEventListener('keydown', onEscape);
        };
    }, [quickMenuOpen]);

    const carregarGithub = async (): Promise<void> => {
        try {
            const response = await fetch('/dashboard/solaris/github/status', {cache:'no-store'});
            if (!response.ok) return;
            const status = await response.json() as SolarisGithubStatus;
            setGithubStatus(status);
            if (status.repository) setGithubRepository('https://github.com/' + status.repository);
        } catch { setGithubStatus(null); }
    };
    const listarRepositoriosGithub = async (): Promise<void> => {
        if (!githubStatus?.connected || githubReposBusy) return;
        setGithubReposBusy(true);
        try {
            const response = await fetch('/dashboard/solaris/github/repositories', {cache:'no-store'});
            const result = await response.json() as {repositories?:Array<{name:string;private:boolean;canPush:boolean}>;truncated?:boolean;erro?:string};
            if (!response.ok) throw Error(result.erro || 'Falha ao listar repositórios.');
            setGithubRepos(result.repositories || []);
            setGithubReposTruncated(result.truncated === true);
            setToolError((result.repositories || []).length ? '' : 'Nenhum repositório autorizado. Instale a GitHub App nos repositórios desejados.');
        } catch(e) { setToolError(e instanceof Error ? e.message : 'Falha no catálogo GitHub.'); }
        finally { setGithubReposBusy(false); }
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
            setGithubRepos([]);
            setGithubProposal({state:'none'});
        } catch (e) { setToolError(e instanceof Error ? e.message : 'Falha ao desconectar.'); }
        finally { setGithubBusy(false); }
    };

    const carregarPropostaGithub = async (): Promise<void> => {
        try {
            const response = await fetch('/dashboard/solaris/github/pending', {cache:'no-store'});
            if (response.ok) setGithubProposal(await response.json() as GithubProposal);
        } catch { /* Não descartar proposta quando a rede oscilar. */ }
    };
    const aprovarPropostaGithub = async (): Promise<void> => {
        if (githubProposal.state !== 'pending' || githubApprovalBusy) return;
        if (!window.confirm('Criar uma branch e abrir um pull request rascunho com as alterações exibidas?')) return;
        setGithubApprovalBusy(true); setToolError('');
        try {
            const response = await fetch('/dashboard/solaris/github/approve', {
                method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'
            });
            const data = await response.json() as {erro?:string;result?:{prUrl:string;branch:string;prNumber:number;commits:string[]}};
            if (!response.ok || !data.result) throw Error(data.erro || 'Não foi possível publicar a proposta.');
            setGithubProposal({state:'completed',result:data.result});
            setMessages(prev=>[...prev,{role:'assistant',
                content:'GitHub: branch **'+data.result!.branch+'** criada. Pull request rascunho: '+data.result!.prUrl}]);
        } catch(e) {
            setToolError(e instanceof Error?e.message:'Falha ao aprovar GitHub');
            void carregarPropostaGithub();
        } finally { setGithubApprovalBusy(false); }
    };
    const cancelarPropostaGithub = async (): Promise<void> => {
        if (githubApprovalBusy) return;
        setGithubApprovalBusy(true);
        try {
            const response = await fetch('/dashboard/solaris/github/pending',{method:'DELETE'});
            if(!response.ok) throw Error('Não foi possível cancelar a proposta.');
            setGithubProposal({state:'cancelled'});
        } catch(e) { setToolError(e instanceof Error?e.message:'Falha ao cancelar a proposta.'); }
        finally {setGithubApprovalBusy(false);}
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
        void carregarPropostaGithub();
        const retornoGithub = new URLSearchParams(window.location.search).get('github');
        if (retornoGithub === 'connected') {
            setActiveTool('github');
            setToolsOpen(true);
            setQuickMenuOpen(true);
        } else if (retornoGithub === 'denied' || retornoGithub === 'error' || retornoGithub === 'setup') {
            setActiveTool('github');
            setToolsOpen(true);
            setQuickMenuOpen(true);
            setToolError(retornoGithub === 'setup'
                ? 'A conexão GitHub precisa ser configurada pelo administrador da Softload.'
                : 'A autorização do GitHub não foi concluída. Você pode tentar novamente.');
        }
    }, []);

    // Rolar até a mensagem mais recente
    useEffect(() => {
        const feed = chatFeedRef.current;
        if (feed && shouldFollowRef.current) feed.scrollTop = feed.scrollHeight;
    }, [messages, statusText, statusHistory]);

    const carregarCreditos = async (): Promise<void> => {
        // O Solaris não pode mostrar créditos Gemini legados como saldo V2.
        // Em falha da contabilidade ativa, exibir saldo indisponível.
        const saldo = await consultarSaldoSolaris();
        setSaldoFonte(saldo.fonte);
        if (saldo.fonte !== 'indisponivel') {
            setCredits({ creditos: saldo.disponiveis, creditosTotal: saldo.total });
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
        shouldFollowRef.current = true;
        setShowJumpToLatest(false);
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
                    shouldFollowRef.current = true;
                    setShowJumpToLatest(false);
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

    const handleSend = async (e?: React.FormEvent<HTMLFormElement> | null, textToSend: string | null = null): Promise<void> => {
        if (e) e.preventDefault();
        const msg = (textToSend || input).trim();
        if (!msg || loading) return;
        if (activeTool === 'github' && !/^(?:https:\/\/github\.com\/)?[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}(?:\.git)?\/?$/.test(githubRepository.trim())) {
            setToolError('Cole o link do repositório: https://github.com/dono/repositorio');
            return;
        }
        if (activeTool === 'github' && githubStatus) {
            const solicitado = githubRepository.trim()
                .replace(/^https:\/\/github\.com\//i, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
            if (githubStatus.connected && !githubStatus.repository) {
                setToolError('Conta conectada. Primeiro clique em Vincular repositório.');
                setQuickMenuOpen(true);
                setToolsOpen(true);
                return;
            }
            if (githubStatus.connected && githubStatus.repository?.toLowerCase() !== solicitado.toLowerCase()) {
                setToolError('Vincule o repositório informado antes de enviar a tarefa.');
                setQuickMenuOpen(true);
                setToolsOpen(true);
                return;
            }
            if (!githubStatus.connected && githubStatus.account) {
                setToolError('Sua autorização GitHub expirou. Conecte novamente.');
                setQuickMenuOpen(true);
                setToolsOpen(true);
                return;
            }
        }
        setToolError('');
        setInput('');
        setLoading(true);
        setStatusHistory([]);
        setStatusText('Iniciando conexão...');

        // Adicionar mensagem do usuário
        const updatedHistory: ChatMessage[] = [...messages, { role: 'user', content: msg }];
        shouldFollowRef.current = true;
        setShowJumpToLatest(false);
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
                throw new Error(await extrairErroRespostaChat(response));
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
                        if (activeTool === 'github') void carregarPropostaGithub();
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
        <div className="sl-conversation d-flex flex-column">
            {/* Topbar do Chat */}
            <div className="sl-conversation__header d-flex align-items-center justify-content-between gap-2 p-2 p-md-3 border-bottom flex-shrink-0 flex-wrap">
                <div className="sl-conversation__heading d-flex align-items-center gap-2 gap-sm-3" style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center justify-content-center rounded-3 bg-opacity-10 bg-primary border border-primary flex-shrink-0" style={{ width: '40px', height: '40px' }}>
                        <Cpu size={20} className="text-info" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <h1 className="fw-bolder text-uppercase mb-0 d-flex align-items-center gap-2" style={{ fontSize: '1.05rem', letterSpacing: '-0.02em', minWidth: 0 }}>
                            <span className="text-truncate" style={{ minWidth: 0 }}>Solaris Code</span>
                        </h1>
                        <p className="mb-0 text-secondary d-none d-md-block text-truncate" style={{ fontSize: '0.75rem' }}>Arquiteto front/back-end leve de alto desempenho.</p>
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    {/* Exibição de créditos — sempre visível (era d-none d-sm-flex,
                        sumia por completo abaixo de 576px) */}
                    <div className="sl-conversation__credit d-flex align-items-center gap-1 px-2 py-1 rounded"
                        style={{ fontSize: '0.7rem', fontWeight: 700 }}
                        title={saldoFonte === 'v2' ? 'Créditos de IA do Solaris (orçamento por modelo)' : saldoFonte === 'indisponivel' ? 'Não foi possível consultar os créditos.' : 'Créditos Gemini disponíveis'}
                        role="status"
                        aria-label={saldoFonte === 'indisponivel' ? 'Saldo indisponível' : `${credits.creditos} de ${credits.creditosTotal} créditos ${saldoFonte === 'v2' ? 'Solaris' : 'Gemini'} disponíveis`}>
                        <Zap size={11} className="text-warning" />
                        <span>{saldoFonte === 'indisponivel' ? '—' : credits.creditos.toLocaleString('pt-BR')}</span>
                        {saldoFonte !== 'indisponivel' && <>
                            <span className="text-muted d-none d-sm-inline">/</span>
                            <span className="text-muted d-none d-sm-inline">{credits.creditosTotal.toLocaleString('pt-BR')}</span>
                        </>}
                        {saldoFonte === 'v2' && <span className="text-info ms-1">IA</span>}
                    </div>

                    <ChatHeaderActions
                        onHistory={() => setDrawerOpen(true)}
                        onNewChat={iniciarNovaConversa}
                        disableNewChat={loading}
                    />
                </div>
            </div>

            {/* Corpo de Mensagens */}
            <div className="sl-conversation__feed-shell d-flex flex-column flex-grow-1">
                <div className="sl-conversation__feed flex-grow-1 p-3 p-md-4"
                ref={chatFeedRef}
                onScroll={() => {
                    const feed = chatFeedRef.current;
                    if (feed) {
                        const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 120;
                        shouldFollowRef.current = nearBottom;
                        setShowJumpToLatest(!nearBottom);
                    }
                }}>
                <div className="sl-conversation__content d-flex flex-column gap-4 pb-4">
                    {messages.length === 0 ? (
                        <div className="sl-conversation__welcome d-flex flex-column align-items-center justify-content-center text-center py-5">
                            <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.3 }}
                                className="sl-conversation__welcome-icon rounded-4 d-flex align-items-center justify-content-center mb-3"
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
                            
                            <div className="sl-conversation__suggestions d-grid gap-2 w-100" style={{ maxWidth: '620px' }}>
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
                                    <div className="sl-conversation__who small mb-2"><span className={isAssistant ? "sl-conversation__avatar sl-conversation__avatar--assistant" : "sl-conversation__avatar sl-conversation__avatar--user"} aria-hidden="true">{isAssistant ? <Cpu size={15} /> : "EU"}</span><span>{isAssistant ? "Solaris Code" : "Você"}</span></div>
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

                                    {/* Footer da Bolha */}
                                    {isAssistant && (
                                        <div className="d-flex align-items-center gap-2 mt-1 px-1">
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
                        <div role="status" aria-live="polite" className="sl-conversation__status d-flex align-items-center gap-2 small">
                            <RefreshCw size={13} className="text-info animate-spin" />
                            <span>{statusText}</span>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>
                </div>
                {showJumpToLatest && messages.length > 0 && (
                    <button
                        type="button"
                        className="sl-conversation__jump"
                        onClick={scrollToLatest}
                        aria-label="Ir para a mensagem mais recente"
                    >
                        <ArrowDown size={16} aria-hidden="true" />
                        <span>Última mensagem</span>
                    </button>
                )}
            </div>

            {/* Input e Controles de Chat */}
            <div className="sl-conversation__composer p-3 flex-shrink-0">
                <div className="sl-conversation__composer-inner">
                    {activeTool === 'github' && toolError && (
                        <p className="small text-warning mb-2" role="alert">{toolError}</p>
                    )}
                    {githubProposal.state === 'failed' && (
                        <p className="small text-warning mb-2" role="alert">
                            A publicação não foi concluída. Verifique a branch criada no GitHub antes de iniciar outra proposta.
                        </p>
                    )}
                    {githubProposal.state === 'pending' && (
                        <section className="border border-info rounded-3 p-3 mb-3 bg-dark text-light" aria-label="Proposta GitHub pendente">
                            <div className="fw-bold small mb-1">GitHub — revisar antes de publicar</div>
                            <p className="small text-secondary mb-2">{githubProposal.repository} · {githubProposal.files?.length || 0} arquivo(s).
                                A aprovação cria uma branch e um PR rascunho, sem alterar a principal.
                            </p>
                            <div style={{maxHeight:'24vh',overflowY:'auto'}}>
                                {(githubProposal.files || []).map(file => (
                                    <details key={file.path} className="mb-2">
                                        <summary className="small">{file.operation === 'edit' ? 'Editar' : 'Criar'}: {file.path} — {file.summary}</summary>
                                        <pre className="small p-2 mt-1 rounded bg-black text-light"
                                            style={{whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:'240px',overflowY:'auto'}}>{file.proposedContent}</pre>
                                    </details>
                                ))}
                            </div>
                            <div className="d-flex flex-wrap gap-2 mt-2">
                                <button type="button" className="btn btn-info btn-sm"
                                    disabled={loading || githubApprovalBusy} onClick={()=>{void aprovarPropostaGithub();}}>
                                    {githubApprovalBusy?'Publicando...':'Aprovar e abrir PR'}
                                </button>
                                <button type="button" className="btn btn-outline-secondary btn-sm"
                                    disabled={githubApprovalBusy} onClick={()=>{void cancelarPropostaGithub();}}>Descartar</button>
                            </div>
                        </section>
                    )}
                    {githubProposal.state === 'completed' && githubProposal.result?.prUrl?.startsWith('https://github.com/') && (
                        <a href={githubProposal.result.prUrl} target="_blank" rel="noopener noreferrer"
                            className="small d-block mb-2 text-info">Ver pull request rascunho no GitHub</a>
                    )}
                    <div className="sl-conversation__actions-scope" ref={quickMenuRef}>
                        {quickMenuOpen && (
                            <div id="solaris-actions-menu" className="sl-conversation__actions-popover" role="group" aria-label="Opções e ferramentas do Solaris">
                                <div className="sl-conversation__actions-title">Opções e ferramentas</div>
                    <div className="sl-conversation__actions-sections">
                        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                            <button
                                type="button"
                                className="btn btn-outline-info btn-sm d-flex align-items-center gap-2"
                                aria-expanded={toolsOpen}
                                aria-controls="solaris-tools-panel"
                                onClick={() => setToolsOpen(open => !open)}
                                disabled={loading}
                            >
                                <Wrench size={15} /> Ferramentas
                            </button>
                            {activeTool !== 'none' && (
                                <span className="badge rounded-pill bg-info bg-opacity-25 text-info">
                                    {activeTool === 'asset-forge-2d' ? 'Criar Assets 2D ativo' : 'GitHub ativo'}
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
                                        disabled={loading}
                                        onClick={() => { setActiveTool('asset-forge-2d'); setToolError(''); setQuickMenuOpen(false); setToolsOpen(false); }}>
                                        <Shapes size={14} className="me-1" /> Criar Assets 2D
                                    </button>
                                    <button type="button" className={`btn btn-sm ${activeTool === 'github' ? 'btn-info' : 'btn-outline-secondary'}`}
                                        aria-pressed={activeTool === 'github'}
                                        disabled={loading}
                                        onClick={() => { setActiveTool('github'); setToolError(''); }}>
                                        <GitBranch size={14} className="me-1" /> GitHub
                                    </button>
                                    <button type="button" className={`btn btn-sm ${activeTool === 'none' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                                        aria-pressed={activeTool === 'none'}
                                        onClick={() => { setActiveTool('none'); setToolError(''); setQuickMenuOpen(false); setToolsOpen(false); }}
                                        disabled={loading}>
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
                                        <label htmlFor="solaris-github-repo" className="small text-secondary">Link do repositório GitHub</label>
                                        <input id="solaris-github-repo" type="url"
                                            className="form-control form-control-sm bg-dark text-light border-secondary"
                                            placeholder="https://github.com/dono/repositorio"
                                            value={githubRepository}
                                            maxLength={240}
                                            onChange={e => { setGithubRepository(e.target.value); setToolError(''); }}
                                            disabled={loading} />
                                        {githubStatus?.connected && (
                                            <div className="d-flex flex-column gap-2">
                                                <button type="button" className="btn btn-outline-info btn-sm align-self-start"
                                                    disabled={githubBusy || githubReposBusy || loading}
                                                    onClick={() => { void listarRepositoriosGithub(); }}>
                                                    {githubReposBusy ? 'Consultando...' : 'Listar repositórios autorizados'}
                                                </button>
                                                {githubRepos.length > 0 && (
                                                    <select className="form-select form-select-sm" aria-label="Selecionar repositório autorizado"
                                                        defaultValue="" disabled={loading || githubBusy}
                                                        onChange={e => { if (e.target.value) setGithubRepository('https://github.com/' + e.target.value); }}>
                                                        <option value="">Escolha um repositório</option>
                                                        {githubRepos.map(r => <option key={r.name} value={r.name}>
                                                            {r.name}{r.private ? ' (privado)' : ''}{!r.canPush ? ' (somente leitura)' : ''}
                                                        </option>)}
                                                    </select>
                                                )}
                                                {githubReposTruncated && <small className="text-warning">Lista parcial. Também é possível colar o link.</small>}
                                            </div>
                                        )}
                                        <div className="d-flex flex-wrap gap-2 align-items-center">
                                            {githubStatus?.connected ? (
                                                <>
                                                    <span className="small text-info">
                                                        <CheckCircle2 size={13} className="me-1" />
                                                        Conectado como {githubStatus.account}
                                                    </span>
                                                    <span className="small text-secondary">
                                                        {githubStatus.mcpEnabled ? 'MCP GitHub configurado: consultas somente leitura.' : 'REST disponível; MCP remoto desativado.'}
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
                                                ? githubStatus.repository
                                                    ? 'Repositório vinculado: ' + githubStatus.repository + '. Peça alterações no chat: o Solaris lê os arquivos e prepara uma proposta. Somente você pode aprovar a branch e o PR rascunho.'
                                                    : 'Conta autorizada, mas nenhum repositório foi vinculado. Cole o link acima e clique em Vincular repositório antes de dar comandos ao agente.'
                                                : githubStatus?.account
                                                    ? 'A autorização anterior expirou. Clique em Conectar GitHub para autorizar novamente a conta.'
                                                : githubStatus?.configured
                                                    ? 'Na primeira conexão, o GitHub pedirá autorização à GitHub App. Depois escolha o repositório. Repositórios públicos também podem ser consultados pelo link sem login.'
                                                    : 'A conexão de contas requer configurar a GitHub App na Softload. Por enquanto, o link de um repositório público funciona para análise em modo somente leitura.'}
                                        </p>
                                    </div>
                                )}
                                {toolError && <p className="small text-warning mb-0" role="alert">{toolError}</p>}
                            </div>
                        )}
                    </div>

                            </div>
                        )}
                    <form onSubmit={handleSend} className="d-flex gap-2">
                        <button
                            ref={quickTriggerRef}
                            type="button"
                            className="sl-conversation__plus-button"
                            aria-label="Abrir opções e ferramentas"
                            title="Opções e ferramentas"
                            aria-haspopup="true"
                            aria-expanded={quickMenuOpen}
                            aria-controls="solaris-actions-menu"
                            onClick={() => setQuickMenuOpen(open => !open)}
                        >
                            <Plus size={21} aria-hidden="true" />
                            {activeTool !== 'none' && <span className="sl-conversation__active-dot" aria-hidden="true" />}
                        </button>
                        <div className="flex-grow-1 position-relative">
                            <textarea 
                                className="sl-conversation__input form-control pe-5 py-2"
                                rows={1}
                                placeholder="Fale com o Solaris..."
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
                    </div>
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
                            className="sl-conversation__history-drawer position-fixed top-0 bottom-0 start-0 border-end"
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
                                        const dateStr = Number.isNaN(date.getTime()) ? 'Data indisponível'
                                            : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' +
                                              date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                        const title = s.firstMessage || '(conversa vazia)';
                                        return (
                                            <div key={s.sessionId}
                                                className={`sl-conversation__history-row d-flex align-items-center gap-1 ${sessionId === s.sessionId ? 'is-active' : ''}`}>
                                                <button type="button"
                                                    className="sl-conversation__history-select d-flex flex-grow-1 text-start"
                                                    aria-current={sessionId === s.sessionId ? 'page' : undefined}
                                                    aria-label={`Abrir conversa: ${title}`}
                                                    onClick={() => carregarSessao(s.sessionId)}>
                                                    <span className="min-w-0 flex-grow-1">
                                                        <span className="sl-conversation__history-name d-block text-truncate fw-semibold">{title}</span>
                                                        <span className="sl-conversation__history-meta d-block text-truncate">
                                                            {dateStr} · {s.messageCount || 0} mensagens
                                                        </span>
                                                    </span>
                                                </button>
                                                <button type="button"
                                                    className="sl-conversation__history-delete d-flex align-items-center justify-content-center flex-shrink-0"
                                                    onClick={(e) => excluirSessao(e, s.sessionId)}
                                                    aria-label={`Excluir conversa: ${title}`}
                                                    title="Excluir conversa">
                                                    <Trash2 size={17} aria-hidden="true" />
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
