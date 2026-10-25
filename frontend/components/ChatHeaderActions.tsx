import React, { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis, History, PlusCircle } from 'lucide-react';

interface ChatHeaderActionsProps {
    onHistory: () => void;
    onNewChat: () => void;
    disableNewChat?: boolean;
}

// Menu compartilhado pelos chats: não ocupa duas ações inteiras no cabeçalho móvel.
export default function ChatHeaderActions({
    onHistory, onNewChat, disableNewChat = false
}: ChatHeaderActionsProps): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelId = useId();

    useEffect(() => {
        if (!open) return;
        const onOutside = (event: PointerEvent): void => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onOutside);
        document.addEventListener('keydown', onEscape);
        return () => {
            document.removeEventListener('pointerdown', onOutside);
            document.removeEventListener('keydown', onEscape);
        };
    }, [open]);

    return (
        <div className="sl-conversation__head-actions" ref={rootRef}>
            <button
                ref={triggerRef}
                type="button"
                className="sl-conversation__icon-button"
                aria-label="Opções da conversa"
                title="Opções da conversa"
                aria-haspopup="true"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(value => !value)}
            >
                <Ellipsis size={20} aria-hidden="true" />
            </button>
            {open && (
                <div id={panelId} className="sl-conversation__head-popover" role="group" aria-label="Ações da conversa">
                    <button type="button" className="sl-conversation__action-item"
                        onClick={() => { setOpen(false); onHistory(); }}>
                        <History size={17} aria-hidden="true" /> Histórico
                    </button>
                    <button type="button" className="sl-conversation__action-item"
                        disabled={disableNewChat}
                        onClick={() => { setOpen(false); onNewChat(); }}>
                        <PlusCircle size={17} aria-hidden="true" /> Nova conversa
                    </button>
                </div>
            )}
        </div>
    );
}
