'use strict';
interface CreditRecord {
  creditos?: number;
  creditos_expira_em?: string | number | { toDate?: () => Date };
}
interface CreditSnapshot {
  exists: boolean;
  data(): CreditRecord | undefined;
}
interface CreditDb {
  collection(name: string): { doc(email: string): { get(): Promise<CreditSnapshot> } };
}
interface CreditRequest { session?: { user?: { email?: unknown; plano?: string } } }
interface CreditResponse {
  status(code: number): CreditResponse;
  json(body: { erro: string; codigo: string }): unknown;
}
type Next = () => unknown;
interface GateOptions { db: CreditDb; clock?: () => number }
declare const module: { exports: unknown };
/** Permite Workspace em todos os planos; IA só com créditos Gemini reais. */
function criarGateCreditosWorkspace({db, clock=()=>Date.now()}: GateOptions) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore obrigatório');
  return async function verificarCreditosWorkspace(req: CreditRequest,res: CreditResponse,next: Next): Promise<unknown> {
    const email=req.session?.user?.email;
    if (typeof email!=='string'||!email.trim())
      return res.status(401).json({erro:'Faça login para usar a IA do Workspace.',codigo:'SESSAO_EXPIRADA'});
    try {
      const doc=await db.collection('clientes_premium').doc(email.toLowerCase()).get();
      if(!doc.exists) return res.status(402).json({erro:'Esta conta ainda não tem créditos Gemini.',codigo:'SEM_CREDITOS'});
      const dados=doc.data()||{};
      if(dados.creditos_expira_em) {
        const expire=typeof (dados.creditos_expira_em as {toDate?: () => Date}).toDate==='function'
          ? (dados.creditos_expira_em as {toDate: () => Date}).toDate().getTime() : new Date(dados.creditos_expira_em as string).getTime();
        if(!Number.isFinite(expire)||expire<clock())
          return res.status(402).json({erro:'Seus créditos Gemini expiraram.',codigo:'CREDITOS_EXPIRADOS'});
      }
      if(typeof dados.creditos!=='number'||!Number.isFinite(dados.creditos)||dados.creditos<=0)
        return res.status(402).json({erro:'Seus créditos Gemini acabaram. Recarregue para continuar.',codigo:'SEM_CREDITOS'});
      return next();
    } catch (e) {
      console.error('[WORKSPACE] Falha ao verificar saldo:',(e as Error)?.message||'erro');
      return res.status(503).json({erro:'Não foi possível consultar seus créditos.',codigo:'SALDO_INDISPONIVEL'});
    }
  };
}
module.exports={criarGateCreditosWorkspace};
export {};

/** Exact CommonJS dependency surface consumed by the HTTP routes. */
export type RouteExports = { criarGateCreditosWorkspace: typeof criarGateCreditosWorkspace };
