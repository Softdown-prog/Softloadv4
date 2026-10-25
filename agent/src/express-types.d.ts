/**
 * Superficie minima dos tipos HTTP usada pelo Worker Agent. Apenas para
 * a checagem TypeScript; nenhum codigo e emitido nem dependencias
 * adicionadas ao container de producao.
 */
declare module "express" {
  export interface Request {
    body: any; // untrusted JSON; parseTaskRequest valida antes de executar
    params: Record<string, string>;
    get(name: string): string | undefined;
  }
  export interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
  }
  export type NextFunction = () => void;
  export interface Application {
    use(middleware: unknown): void;
    get(path: string, handler: (req: Request, res: Response) => unknown): void;
    post(
      path: string,
      ...handlers: Array<(req: Request, res: Response, next: NextFunction) => unknown>
    ): void;
    listen(port: string | number, callback?: () => void): {
      close(callback?: () => void | Promise<void>): void;
    };
  }
  const express: {
    (): Application;
    json(options: { limit: string }): unknown;
  };
  export default express;
}
