import { useEffect, useRef } from 'react';

// Timeline de entrada do hero da landing (GSAP) + scroll-reveal dos
// feature cards (ScrollTrigger). GSAP é pesado (~70KB) e só é usado nesta
// página — import() dinâmico em vez de import estático, mesmo padrão já
// usado em DonutChart.jsx (chart.js) e MermaidBlock.jsx (mermaid), pra
// não pagar esse custo em main.js pra todo visitante do site.
//
// Os elementos-alvo (data-hero="...", [data-hero-line], .feat-card) já
// nascem invisíveis via CSS (".js-anim [data-hero=...] { opacity:0 }",
// ver softload.css seção 19) — a classe .js-anim é armada por um script
// síncrono no HTML (antes do React montar, ver views/pages/react-landing.ejs)
// e só é removida aqui, depois que os nós já existem no DOM e o GSAP já
// carregou. Isso evita o flash que existiria se a remoção da classe
// dependesse só do timing do import() dinâmico.
export default function useHeroEntrance(onEntranceDone: () => void): void {
    const disparadoRef = useRef(false);

    useEffect(() => {
        const root = document.documentElement;
        const reduzirMovimento = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function revelar() {
            root.classList.remove('js-anim');
        }

        function concluir() {
            revelar();
            if (!disparadoRef.current) {
                disparadoRef.current = true;
                onEntranceDone();
            }
        }

        if (reduzirMovimento) {
            concluir();
            return;
        }

        let cancelado = false;
        const cleanupGsap = { current: null as (() => void) | null };

        import('gsap').then(async ({ gsap }) => {
            if (cancelado) return;

            let ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger | null = null;
            try {
                const mod = await import('gsap/ScrollTrigger');
                ScrollTrigger = mod.ScrollTrigger;
                gsap.registerPlugin(ScrollTrigger);
            } catch (_) {
                // scroll-reveal dos feature cards é cosmético — segue sem ele
            }
            if (cancelado) return;

            const linhas = gsap.utils.toArray<HTMLElement>('[data-hero-line]');
            const chips = gsap.utils.toArray<HTMLElement>('[data-hero="chips"] .chip-item');
            const painel = document.querySelector<HTMLElement>('[data-hero="panel"]');

            gsap.set(linhas, { yPercent: 110 });
            gsap.set('[data-hero="badge"], [data-hero="lead"], [data-hero="cta"], [data-hero="trust"]', { opacity: 0, y: 24 });
            gsap.set(chips, { opacity: 0, scale: 0.9 });
            if (painel) gsap.set(painel, { opacity: 0, y: 40, scale: 0.97 });

            revelar();

            function iniciarFlutuacao() {
                if (!painel) return;
                gsap.to(painel, { y: -10, duration: 3, ease: 'sine.inOut', repeat: -1, yoyo: true });
            }

            const tl = gsap.timeline({
                defaults: { ease: 'power3.out' },
                onComplete: function () {
                    iniciarFlutuacao();
                    if (!disparadoRef.current) {
                        disparadoRef.current = true;
                        onEntranceDone();
                    }
                },
            });

            tl.to('[data-hero="badge"]', { opacity: 1, y: 0, duration: 0.5 })
              .to(linhas, { yPercent: 0, duration: 0.9, stagger: 0.12, ease: 'power4.out' }, '-=0.25')
              .to('[data-hero="lead"]', { opacity: 1, y: 0, duration: 0.55 }, '-=0.5')
              .to(chips, { opacity: 1, scale: 1, duration: 0.45, stagger: 0.06 }, '-=0.3')
              .to('[data-hero="cta"]', { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
              .to('[data-hero="trust"]', { opacity: 1, y: 0, duration: 0.45 }, '-=0.35');

            if (painel) {
                tl.to(painel, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'power3.out' }, '-=0.85');
            }

            if (ScrollTrigger) {
                gsap.utils.toArray<HTMLElement>('.feat-card').forEach(function (card) {
                    gsap.from(card, {
                        opacity: 0,
                        y: 60,
                        ease: 'none',
                        scrollTrigger: { trigger: card, start: 'top 88%', end: 'top 55%', scrub: 1 },
                    });
                });
            }

            cleanupGsap.current = () => {
                tl.kill();
                if (ScrollTrigger) ScrollTrigger.getAll().forEach(st => st.kill());
            };
        }).catch(() => {
            // CDN/rede falhou em entregar o gsap — mostra estático, libera a demo
            concluir();
        });

        // Falha graciosa: se o import() nunca resolver a tempo por qualquer
        // motivo, revela o conteúdo mesmo assim em vez de deixá-lo preso
        // em opacity:0 pra sempre.
        const failsafeRevelar = setTimeout(revelar, 1500);
        const failsafeDemo = setTimeout(concluir, 3000);

        return () => {
            cancelado = true;
            clearTimeout(failsafeRevelar);
            clearTimeout(failsafeDemo);
            if (cleanupGsap.current) cleanupGsap.current();
        };
    }, [onEntranceDone]);
}
