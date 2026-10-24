import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import { Clipboard, Check } from 'lucide-react';

hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);

const APELIDOS = { js: 'JavaScript', html: 'HTML', xml: 'XML', css: 'CSS', json: 'JSON', bash: 'Bash', sh: 'Shell' };

// Bloco de código do chat — pill com o nome da linguagem + botão de copiar,
// e highlight via highlight.js (core + só as linguagens reais do domínio:
// XML/HTML do Blogger, CSS, JS, JSON, Bash). Mesmo padrão de import estático
// já usado por MermaidBlock.jsx (o bundle inteiro já é carregado pelas
// páginas de chat de qualquer forma).
export default function CodeBlock({ code, language }) {
    const [copiado, setCopiado] = useState(false);

    const { html, langLabel } = useMemo(() => {
        const lang = (language || '').toLowerCase();
        if (lang && hljs.getLanguage(lang)) {
            try {
                return { html: hljs.highlight(code, { language: lang }).value, langLabel: APELIDOS[lang] || lang };
            } catch (_) { /* cai no fallback abaixo */ }
        }
        const auto = hljs.highlightAuto(code);
        return { html: auto.value, langLabel: APELIDOS[auto.language] || auto.language || 'texto' };
    }, [code, language]);

    function copiar() {
        navigator.clipboard.writeText(code).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        });
    }

    return (
        <div className="sl-code-block">
            <div className="sl-code-header">
                <span className="sl-code-lang">{langLabel}</span>
                <button type="button" className="sl-code-copy-btn" onClick={copiar} aria-label="Copiar código">
                    {copiado ? <><Check size={11} /> Copiado</> : <><Clipboard size={11} /> Copiar</>}
                </button>
            </div>
            <pre className="sl-code-pre"><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
        </div>
    );
}
