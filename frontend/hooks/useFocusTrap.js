import { useEffect } from 'react';

const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function elementosFocaveis(container) {
    return Array.from(container.querySelectorAll(SELETOR_FOCAVEL))
        .filter(el => el.offsetParent !== null);
}

// Focus trap + tecla Escape + devolução de foco, para drawers e modais
// abertos condicionalmente (não usam <dialog> nativo). onClose deve ser
// estável (useCallback ou função definida fora do render) para não
// reabrir o efeito a cada render.
export default function useFocusTrap(containerRef, isOpen, onClose) {
    useEffect(() => {
        if (!isOpen) return;
        const container = containerRef.current;
        if (!container) return;

        const elementoAnterior = document.activeElement;
        const focaveis = elementosFocaveis(container);
        (focaveis[0] || container).focus();

        function handleKeyDown(e) {
            if (e.key === 'Escape') {
                onClose();
                return;
            }
            if (e.key !== 'Tab') return;

            const itens = elementosFocaveis(container);
            if (itens.length === 0) return;
            const primeiro = itens[0];
            const ultimo = itens[itens.length - 1];

            if (e.shiftKey && document.activeElement === primeiro) {
                e.preventDefault();
                ultimo.focus();
            } else if (!e.shiftKey && document.activeElement === ultimo) {
                e.preventDefault();
                primeiro.focus();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (elementoAnterior && typeof elementoAnterior.focus === 'function') {
                elementoAnterior.focus();
            }
        };
    }, [isOpen, onClose]);
}
