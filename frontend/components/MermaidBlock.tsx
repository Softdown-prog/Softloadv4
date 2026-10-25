import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let contador = 0;

// Renderiza um bloco ```mermaid``` como diagrama SVG — equivalente React do
// que views/pages/dashboard/chat.ejs fazia carregando mermaid.js via CDN e
// chamando mermaid.run() nos nós .mermaid recém-inseridos no DOM. Aqui o
// mermaid vem empacotado pelo Vite (self-contained, sem depender de CDN
// externo em runtime) e o render é por instância de componente.
export interface MermaidBlockProps {
    code: string;
}

export default function MermaidBlock({ code }: MermaidBlockProps): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        let cancelado = false;
        const id = `sl-mermaid-${++contador}`;

        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'default',
        });

        mermaid.render(id, code)
            .then(({ svg }) => {
                if (!cancelado && containerRef.current) {
                    containerRef.current.innerHTML = svg;
                    setErro(null);
                }
            })
            .catch((err) => {
                console.error('[mermaid] falha ao renderizar diagrama:', err);
                if (!cancelado) setErro(err instanceof Error && err.message ? err.message : 'Falha ao renderizar diagrama.');
            });

        return () => { cancelado = true; };
    }, [code]);

    if (erro) {
        return (
            <pre className="sl-code-block" style={{ whiteSpace: 'pre-wrap' }}>
                <code>{code}</code>
            </pre>
        );
    }

    return <div className="sl-mermaid-block" ref={containerRef} />;
}
