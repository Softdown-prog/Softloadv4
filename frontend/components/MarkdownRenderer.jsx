import React from 'react';
import Markdown from 'react-markdown';
import MermaidBlock from './MermaidBlock';
import CodeBlock from './CodeBlock';

// Wrapper fino sobre <Markdown> usado por todo chat com IA (Chat/Solaris/
// WorkspaceChat/admin Sol) — intercepta blocos de código no nível de <pre>
// (não de <code>, pra não aninhar <div>/pill dentro de <pre>): ```mermaid```
// vira diagrama SVG via MermaidBlock, qualquer outra linguagem ganha
// highlight + pill (nome da linguagem + copiar) via CodeBlock.
const components = {
    pre({ children }) {
        const child = React.Children.only(children);
        const className = child?.props?.className || '';
        const match = /language-(\w+)/.exec(className);
        const code = String(child?.props?.children ?? '').replace(/\n$/, '');

        if (match && match[1] === 'mermaid') {
            return <MermaidBlock code={code} />;
        }
        return <CodeBlock code={code} language={match?.[1]} />;
    },
};

export default function MarkdownRenderer({ children }) {
    return <Markdown components={components}>{children}</Markdown>;
}
