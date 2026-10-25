/**
 * Minimal React 19 root declaration used while the app has no @types/react-dom
 * dependency. Keep this contract scoped to createRoot, the only API used.
 */
declare module 'react-dom/client' {
    import type { ReactNode } from 'react';
    interface Root {
        render(children: ReactNode): void;
        unmount(): void;
    }
    export function createRoot(container: Element | DocumentFragment): Root;
}
