import React, { useEffect, useRef } from 'react';

// Simula uma conversa com a IA dentro do mockup de terminal do hero da
// landing — digita a pergunta na barra de input, move pro chat, mostra
// "pensando...", revela as linhas de resposta e recicla pra próxima
// demo. Tradução direta do antigo script inline de index.ejs: mantido
// como manipulação de DOM imperativa dentro de um useEffect (em vez de
// forçado pra state React) porque é uma máquina de estados com timers
// encadeados e precisos — reescrever pra state puro só trocaria uma
// lógica já testada por uma nova, sem ganho real numa animação decorativa.
type DemoLineKind = 'text' | 'warn' | 'ok' | 'code';
type TerminalMessageKind = 'user' | 'thinking' | DemoLineKind;

interface DemoLine {
    t: DemoLineKind;
    c: string;
}

interface DemoConversation {
    user: string;
    lines: readonly DemoLine[];
}

export interface TerminalDemoProps {
    start: boolean;
}

const DEMOS: readonly DemoConversation[] = [
    {
        user: 'Corrija o XML quebrado do meu template',
        lines: [
            { t: 'text', c: 'Analisando estrutura XML do template...' },
            { t: 'warn', c: "b:section 'main' sem atributo maxwidgets" },
            { t: 'warn', c: 'b:includable id duplicado no widget Footer' },
            { t: 'ok', c: '2 erros corrigidos · compilando...' },
            { t: 'code', c: "<b:section id='main' maxwidgets='3'\n  showaddelement='yes'>" },
        ],
    },
    {
        user: 'Adicione SEO completo ao meu blog',
        lines: [
            { t: 'text', c: 'Gerando meta tags e Open Graph...' },
            { t: 'ok', c: 'og:title, og:description, og:image — ok' },
            { t: 'ok', c: 'Schema JSON-LD: BlogPosting — ok' },
            { t: 'ok', c: 'Twitter Card e canonical URL — ok' },
            { t: 'code', c: "<meta property='og:title'\n  content='<data:blog.pageTitle/>'>" },
        ],
    },
    {
        user: 'Crie widgets AdSense para sidebar e header',
        lines: [
            { t: 'text', c: 'Calculando posições otimizadas para CPM...' },
            { t: 'ok', c: '300×250 sidebar — acima do fold' },
            { t: 'ok', c: '728×90 leaderboard — header' },
            { t: 'ok', c: 'Responsive unit — entre posts' },
            { t: 'code', c: "<b:widget id='AdSense1'\n  type='AdSense' locked='false'>" },
        ],
    },
    {
        user: 'Gere menu responsivo mobile para o blog',
        lines: [
            { t: 'text', c: 'Detectando breakpoints do template...' },
            { t: 'ok', c: 'Hamburger menu nativo construído' },
            { t: 'ok', c: 'CSS @media queries inseridos' },
            { t: 'ok', c: 'Toggle JS sem dependências externas' },
            { t: 'code', c: '@media (max-width:768px) {\n  .nav-desktop { display:none; }\n  .nav-mobile  { display:block; } }' },
        ],
    },
    {
        user: 'Adicione dark mode automático ao template',
        lines: [
            { t: 'text', c: 'Detectando variáveis de cor do template...' },
            { t: 'ok', c: 'Paleta escura gerada (22 variáveis CSS)' },
            { t: 'ok', c: 'prefers-color-scheme configurado' },
            { t: 'ok', c: 'Toggle manual com localStorage' },
            { t: 'code', c: '@media (prefers-color-scheme: dark) {\n  :root { --bg:#0a0f1e;\n    --text:#e2e8f0; } }' },
        ],
    },
];

function avatarHtml(): string {
    return '<div style="width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,#818cf8,#38bdf8);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;font-family:monospace">IA</div>';
}

export default function TerminalDemo({ start }: TerminalDemoProps): React.JSX.Element {
    const chatAreaRef = useRef<HTMLDivElement | null>(null);
    const inputElRef = useRef<HTMLSpanElement | null>(null);
    const indicatorsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!start) return;

        // Os elementos são conferidos logo abaixo; a anotação de não nulo
        // preserva esses tipos dentro dos callbacks agendados pelo timer.
        const chatArea = chatAreaRef.current!;
        const inputEl = inputElRef.current!;
        const indicators = indicatorsRef.current!;
        if (!chatArea || !inputEl || !indicators) return;

        let cancelado = false;
        let timers: ReturnType<typeof setTimeout>[] = [];
        function sched(fn: () => void, ms: number): void { timers.push(setTimeout(fn, ms)); }
        function clearAll(): void { timers.forEach(clearTimeout); timers = []; }

        function scrollFim(): void { chatArea.scrollTop = chatArea.scrollHeight; }

        function addMsg(type: TerminalMessageKind, content: string): HTMLDivElement {
            const el = document.createElement('div');
            el.className = 'term-line mb-2';
            if (type === 'user') {
                el.className += ' d-flex justify-content-end';
                el.innerHTML = '<div class="rounded-3 px-3 py-2" style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.18);max-width:85%"><p class="mb-0" style="font-size:12.5px;color:rgba(255,255,255,.7)">' + content + '</p></div>';
            } else if (type === 'thinking') {
                el.id = 'thinkEl';
                el.innerHTML = '<div class="d-flex gap-2 align-items-center">' + avatarHtml() + '<div class="rounded-3 px-3 py-2" style="background:rgba(129,140,248,.07);border:1px solid rgba(129,140,248,.12)"><span class="think-dot" style="display:inline-block;width:5px;height:5px;background:#818cf8;border-radius:50%;margin:0 2px"></span><span class="think-dot" style="display:inline-block;width:5px;height:5px;background:#818cf8;border-radius:50%;margin:0 2px"></span><span class="think-dot" style="display:inline-block;width:5px;height:5px;background:#818cf8;border-radius:50%;margin:0 2px"></span></div></div>';
            } else if (type === 'text') {
                el.innerHTML = '<div class="d-flex gap-2 align-items-start">' + avatarHtml() + '<div class="rounded-3 px-3 py-2" style="background:rgba(129,140,248,.07);border:1px solid rgba(129,140,248,.12);max-width:90%"><p class="mb-0" style="font-size:12.5px;color:var(--sl-text-300);line-height:1.6">' + content + '</p></div></div>';
            } else if (type === 'ok') {
                el.innerHTML = '<div class="d-flex gap-2 align-items-center ms-5 ps-2"><span style="color:#4ade80;font-size:12px">✓</span><span style="font-size:12px;color:rgba(255,255,255,.6)">' + content + '</span></div>';
            } else if (type === 'warn') {
                el.innerHTML = '<div class="d-flex gap-2 align-items-center ms-5 ps-2"><span style="color:#fbbf24;font-size:12px">⚠</span><span style="font-size:12px;color:rgba(255,255,255,.55)">' + content + '</span></div>';
            } else if (type === 'code') {
                const codeEl = document.createElement('pre');
                codeEl.className = 'mb-0 px-3 py-2';
                codeEl.style.cssText = 'font-size:11px;color:#50fa7b;line-height:1.7;font-family:monospace;white-space:pre';
                codeEl.textContent = content;
                const wrap = document.createElement('div');
                wrap.className = 'ms-5 ps-2 mt-1';
                const inner = document.createElement('div');
                inner.className = 'rounded-3 overflow-hidden';
                inner.style.cssText = 'background:#050a14;border:1px solid rgba(255,255,255,.07)';
                inner.appendChild(codeEl);
                wrap.appendChild(inner);
                el.appendChild(wrap);
            }
            chatArea.appendChild(el);
            scrollFim();
            return el;
        }

        function typeInInput(text: string, done?: () => void): void {
            let i = 0;
            inputEl.textContent = '';
            function step() {
                if (cancelado) return;
                inputEl.textContent = text.slice(0, ++i);
                if (i < text.length) sched(step, 26);
                else if (done) sched(done, 180);
            }
            step();
        }

        function startDemo(idx: number): void {
            if (cancelado) return;
            clearAll();
            chatArea.innerHTML = '';
            inputEl.textContent = '';

            indicators.querySelectorAll('.demo-dot').forEach(function (d, i) {
                d.classList.toggle('active', i === idx);
            });

            const demo = DEMOS[idx];

            sched(function () {
                typeInInput(demo.user, function () {
                    inputEl.textContent = '';
                    addMsg('user', demo.user);

                    sched(function () {
                        addMsg('thinking', '');

                        sched(function () {
                            const th = chatArea.querySelector('#thinkEl');
                            if (th) th.remove();

                            demo.lines.forEach(function (line, i) {
                                sched(function () { addMsg(line.t, line.c); }, i * 370);
                            });

                            const fadeDelay = demo.lines.length * 370 + 2000;
                            sched(function () { chatArea.style.opacity = '0'; }, fadeDelay);
                            sched(function () {
                                chatArea.style.opacity = '1';
                                chatArea.innerHTML = '';
                                startDemo((idx + 1) % DEMOS.length);
                            }, fadeDelay + 380);
                        }, 650);
                    }, 300);
                });
            }, 400);
        }

        indicators.innerHTML = '';
        DEMOS.forEach(function (_, i) {
            const d = document.createElement('span');
            d.className = 'demo-dot' + (i === 0 ? ' active' : '');
            d.setAttribute('role', 'button');
            d.setAttribute('tabindex', '0');
            d.setAttribute('aria-label', 'Ver demonstração ' + (i + 1) + ' de ' + DEMOS.length);
            d.addEventListener('click', function () { startDemo(i); });
            d.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    startDemo(i);
                }
            });
            indicators.appendChild(d);
        });

        startDemo(0);

        return () => {
            cancelado = true;
            clearAll();
        };
    }, [start]);

    return (
        <div className="rounded-4 overflow-hidden position-relative" style={{ background: '#080e1c', border: '1px solid rgba(129,140,248,.18)', boxShadow: '0 0 80px -30px rgba(99,102,241,.3),0 30px 80px -20px rgba(0,0,0,.5)' }}>
            <div className="d-flex align-items-center gap-3 px-4 py-3" style={{ background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <div className="d-flex gap-1">
                    <span className="rounded-circle" style={{ width: 10, height: 10, background: '#ff5f57', display: 'inline-block' }}></span>
                    <span className="rounded-circle" style={{ width: 10, height: 10, background: '#febc2e', display: 'inline-block' }}></span>
                    <span className="rounded-circle" style={{ width: 10, height: 10, background: '#28c840', display: 'inline-block' }}></span>
                </div>
                <span className="font-monospace ms-2" style={{ fontSize: 11, color: 'rgba(255,255,255,.3)' }}>Chat IA · Softload Engine</span>
                <div className="ms-auto d-flex align-items-center gap-2" ref={indicatorsRef}></div>
            </div>

            <div ref={chatAreaRef} id="iaChatArea" className="p-4" style={{ minHeight: 330, maxHeight: 330, overflow: 'hidden', position: 'relative' }}></div>

            <div className="d-flex align-items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,.05)', background: 'rgba(255,255,255,.01)' }}>
                <div className="rounded-2 px-2 py-1 flex-shrink-0" style={{ background: 'rgba(129,140,248,.08)', border: '1px solid rgba(129,140,248,.15)' }}>
                    <span className="font-monospace" style={{ fontSize: 10, color: '#818cf8' }}>você</span>
                </div>
                <span ref={inputElRef} className="flex-fill font-monospace" style={{ fontSize: 12.5, color: 'var(--sl-text-300)', minHeight: 18, whiteSpace: 'nowrap', overflow: 'hidden' }}></span>
                <span className="cursor" style={{ color: '#818cf8', fontSize: 14 }}>▌</span>
                <div className="rounded-2 p-2 ms-2 flex-shrink-0" style={{ background: 'rgba(129,140,248,.1)', border: '1px solid rgba(129,140,248,.2)', cursor: 'pointer' }}>
                    <svg width="14" height="14" fill="none" stroke="#818cf8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </div>
            </div>
        </div>
    );
}
