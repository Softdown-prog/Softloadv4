import 'reflect-metadata';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createRequire } from 'node:module';

// This probe does not load the legacy server, Firebase or commercial routes.
// At runtime dist/guards.js resolves the same pure policy used by Express.
const require=createRequire(import.meta.url);
const {decideAccess}=require('../../src/middlewares/accessPolicy.js') as {
  decideAccess(scope:'session'|'admin'|'worker',request:unknown):
    {allow:boolean;reason?:string;transport?:string};
};

function assertAccess(scope:'session'|'admin'|'worker',context:ExecutionContext):boolean {
  const req=context.switchToHttp().getRequest<unknown>();
  const decision=decideAccess(scope,req);
  if(decision.allow)return true;
  if(decision.reason==='not-found')throw new NotFoundException();
  throw new UnauthorizedException(
    decision.transport==='json'
      ? {error:'Sessão expirada. Recarregue a página e faça login novamente.'}
      : {error:'Sessão expirada. Faça login novamente.'}
  );
}
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context:ExecutionContext):boolean{return assertAccess('session',context);}
}
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context:ExecutionContext):boolean{return assertAccess('admin',context);}
}
@Injectable()
export class WorkerGuard implements CanActivate {
  canActivate(context:ExecutionContext):boolean{return assertAccess('worker',context);}
}
