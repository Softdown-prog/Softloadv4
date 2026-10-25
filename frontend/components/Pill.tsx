import React from 'react';

export interface PillProps {
    tone?: string;
    size?: 'xs' | 'sm' | (string & {});
    uppercase?: boolean;
    pill?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}
const TONES: Record<string, { bg: string; color: string }> = {
    primary: { bg: 'rgba(14,165,233,.15)', color: 'var(--sl-primary)' },
    indigo: { bg: 'rgba(99,102,241,.15)', color: '#818cf8' },
    muted: { bg: 'rgba(255,255,255,.06)', color: 'var(--sl-text-400)' },
};

// Badge pequeno padronizado (tag de contexto, versão, status leve) — cada
// página reimplementava a mesma <span className="badge ..."> com peso,
// tamanho e cor ligeiramente diferentes entre si (8px numa, 9/10px noutra,
// uppercase numa e não noutra). Não substitui .status-badge/.plan-badge do
// admin (softload.css) — aquele já é um sistema reutilizável próprio, com
// mapeamento de cor por plano/status.
export default function Pill({ tone = 'primary', size = 'xs', uppercase = true, pill = true, className = '', style, children }: PillProps): React.JSX.Element {
    const t = TONES[tone] || TONES.primary;
    return (
        <span
            className={`badge fw-black${pill ? ' rounded-pill' : ''}${uppercase ? ' text-uppercase' : ''}${className ? ` ${className}` : ''}`}
            style={{
                fontSize: size === 'sm' ? '10px' : '9px',
                letterSpacing: uppercase ? '0.06em' : undefined,
                background: t.bg,
                color: t.color,
                ...style,
            }}
        >
            {children}
        </span>
    );
}
