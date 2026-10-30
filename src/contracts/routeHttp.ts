/** HTTP contracts for the final route migration. Identity is established by the route guards. */
export interface RouteUser { uid: string; email: string; plano: string; nome?: string; is_active?: boolean; premium_ate?: string | null; [key: string]: unknown }
export interface RouteSession {
    user: RouteUser;
    save(callback: (error?: Error | null) => void): void;
}
export interface RouteRequest<Body = Record<string, unknown>> {
    body: Body; session: RouteSession; params: Record<string, string>;
    query: Record<string, string | undefined> & {state?: string; code?: string; cursor?: string}; headers: Record<string, string | string[] | undefined>;
    protocol: string; ip: string; path: string;
    file?: { buffer: Buffer }; get(name: string): string | undefined;
}
export interface RouteResponse {
    destroyed: boolean; headersSent: boolean;
    status(code: number): RouteResponse; json(body: unknown): void;
    send(body: string): void; redirect(url: string): void;
    render(view: string, data?: Record<string, unknown>): void;
    set(name: string, value: string): RouteResponse;
    setHeader(name: string, value: string): void;
    flushHeaders(): void; write(value: string): boolean; end(): void;
}
export type RouteHandler<Body = Record<string, unknown>> = (req: RouteRequest<Body>, res: RouteResponse, next: () => void) => unknown;
export interface RouteRouter<Body = Record<string, unknown>> {
    get(path: string, ...handlers: RouteHandler<Body>[]): void;
    post(path: string, ...handlers: RouteHandler<Body>[]): void;
    delete(path: string, ...handlers: RouteHandler<Body>[]): void;
    use(path: string, ...handlers: RouteHandler<Body>[]): void;
    SOLARIS_CHAT_SESSION_TYPE?: string;
}
export interface RouteFailure extends Error {
    status?: number; statusCode?: number; type?: string; code?: number | string;
    cause?: RouteFailure & { [index: number]: { description?: string } };
}
export type RouteRateLimit = <B>(options: {
    windowMs: number; max: number; standardHeaders: boolean | 'draft-7'; legacyHeaders: boolean;
    message?: unknown; keyGenerator?: (req: RouteRequest<B>) => string;
    handler?: RouteHandler<B>;
}) => RouteHandler<B>;
