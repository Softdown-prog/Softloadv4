// Nest 12 guard adapters: same pure decision as the current Express guards.
// Not imported by server.js. Only runs in the isolated Nest test application.
import 'reflect-metadata';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {decideAccess}=require('../../src/middlewares/accessPolicy.cjs');

function assertAccess(scope,context) {
  const req=context.switchToHttp().getRequest();
  const decision=decideAccess(scope,req);
  if(decision.allow)return true;
  if(decision.reason==='not-found')throw new NotFoundException();
  throw new UnauthorizedException(
    decision.transport==='json'
      ? {error:'Sessão expirada. Recarregue a página e faça login novamente.'}
      : {error:'Sessão expirada. Faça login novamente.'}
  );
}
export class SessionGuard {
  canActivate(context){return assertAccess('session',context);}
}
export class SuperAdminGuard {
  canActivate(context){return assertAccess('admin',context);}
}
export class WorkerGuard {
  canActivate(context){return assertAccess('worker',context);}
}
for(const Guard of [SessionGuard,SuperAdminGuard,WorkerGuard])Injectable()(Guard);
