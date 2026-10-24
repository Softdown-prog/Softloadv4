import React, { useEffect, useRef } from 'react';
import {
    ArrowRightLeft, Settings2, Grid3x3, TrendingUp, FileJson, Radar,
    Menu as MenuIcon, MoonStar, Zap, Smartphone, LayoutGrid, Share2,
} from 'lucide-react';

const CAPACIDADES = [
    { icon: ArrowRightLeft, cor: '#4ade80', bg: 'rgba(74,222,128,.1)', titulo: 'Corrigir XML quebrado', desc: 'Detecta e corrige b:section, b:widget e b:includable' },
    { icon: Settings2, cor: '#38bdf8', bg: 'rgba(56,189,248,.1)', titulo: 'Gerar widgets Blogger nativos', desc: 'Sidebar, header, rodapé e posts relacionados' },
    { icon: Grid3x3, cor: '#818cf8', bg: 'rgba(129,140,248,.1)', titulo: 'Criar homepage completa', desc: 'Grid de posts, destaque e paginação nativa' },
    { icon: TrendingUp, cor: '#fb923c', bg: 'rgba(251,146,60,.1)', titulo: 'SEO automático', desc: 'Meta tags, Open Graph, Twitter Card e canonical' },
    { icon: FileJson, cor: '#fbbf24', bg: 'rgba(251,191,36,.1)', titulo: 'Schema JSON-LD', desc: 'BlogPosting, BreadcrumbList e Organization' },
    { icon: Radar, cor: '#fb923c', bg: 'rgba(251,146,60,.1)', titulo: 'Estrutura AdSense', desc: 'Slots 300×250, 728×90 e responsive units' },
    { icon: MenuIcon, cor: '#22d3ee', bg: 'rgba(34,211,238,.1)', titulo: 'Menu responsivo mobile', desc: 'Hamburger nativo sem dependências externas' },
    { icon: MoonStar, cor: '#94a3b8', bg: 'rgba(100,116,139,.15)', titulo: 'Dark mode nativo', desc: 'prefers-color-scheme + toggle com localStorage' },
    { icon: Zap, cor: '#4ade80', bg: 'rgba(74,222,128,.1)', titulo: 'Compactação CSS', desc: 'Remove espaços sem quebrar especificidade' },
    { icon: Smartphone, cor: '#f472b6', bg: 'rgba(244,114,182,.1)', titulo: 'Correção mobile', desc: 'Overflow, viewports e imagens responsivas' },
    { icon: LayoutGrid, cor: '#818cf8', bg: 'rgba(129,140,248,.1)', titulo: 'Sidebar com gadgets', desc: 'Posts populares, categorias e busca b:widget real' },
    { icon: Share2, cor: '#38bdf8', bg: 'rgba(56,189,248,.1)', titulo: 'Open Graph dinâmico', desc: 'og:image via data:post.featuredImage do Blogger' },
];

function CapItem({ item, index }) {
    const ref = useRef(null);
    const Icon = item.icon;

    useEffect(() => {
        const el = ref.current;
        if (!el || !('IntersectionObserver' in window)) {
            if (el) { el.style.opacity = '1'; el.style.transform = 'none'; }
            return;
        }

        el.style.opacity = '0';
        el.style.transform = 'translateX(28px)';
        el.style.transition = `opacity .45s ease ${index * 48}ms, transform .45s ease ${index * 48}ms`;

        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    el.style.opacity = '1';
                    el.style.transform = 'translateX(0)';
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -20px 0px' });

        obs.observe(el);
        return () => obs.disconnect();
    }, [index]);

    return (
        <div ref={ref} className="cap-item d-flex gap-3 align-items-center p-3 rounded-3" style={{ border: '1px solid rgba(255,255,255,.06)', background: 'rgba(15,23,42,.5)' }}>
            <div className="cap-icon rounded-2 d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 34, height: 34, background: item.bg }}>
                <Icon size={15} color={item.cor} />
            </div>
            <div className="flex-fill">
                <p className="fw-semibold mb-0 text-white" style={{ fontSize: 13 }}>{item.titulo}</p>
                <p className="mb-0" style={{ fontSize: 11, color: 'var(--sl-text-500)' }}>{item.desc}</p>
            </div>
            <span style={{ color: '#4ade80', fontSize: 13, flexShrink: 0 }}>✓</span>
        </div>
    );
}

export default function CapabilityChecklist() {
    return (
        <div className="d-flex flex-column gap-2">
            {CAPACIDADES.map((item, i) => (
                <CapItem key={item.titulo} item={item} index={i} />
            ))}
        </div>
    );
}
