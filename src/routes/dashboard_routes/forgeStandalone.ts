/** Adapter tipado para o renderizador A7 Forge de execução isolada, sem Worker Agent. */
interface ForgeRouteRequest {
  session: { user?: { email?: string } };
  body?: { receita?: string };
  get(header: string): string | undefined;
}
interface ForgeRouteResponse {
  status(code: number): ForgeRouteResponse;
  type(mime: string): ForgeRouteResponse;
  send(body: string): unknown;
  render(view: string, locals: Record<string, unknown>): unknown;
  set(headers: Record<string, string>): ForgeRouteResponse;
  once(event: string, listener: () => void): unknown;
  destroy(error?: Error): void;
  headersSent?: boolean;
  destroyed?: boolean;
}
type ForgeRouteHandler = (req: ForgeRouteRequest, res: ForgeRouteResponse) => unknown;
declare const require: (specifier: string) => unknown;
const runtime = require('./forgeStandalone.cjs') as {
  show: ForgeRouteHandler;
  download: ForgeRouteHandler;
};
export const show: ForgeRouteHandler = (req, res) => runtime.show(req, res);
export const download: ForgeRouteHandler = (req, res) => runtime.download(req, res);
