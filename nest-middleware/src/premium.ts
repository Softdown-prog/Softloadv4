import {Inject,Injectable} from '@nestjs/common';
import {AccessContractException} from './response-contract.js';
import type {CanActivate,ExecutionContext} from '@nestjs/common';

// Abstraction deliberately excludes firebase-admin. A real reader MUST be
// explicitly injected during the future HTTP migration; tests use in-memory data.
export const PREMIUM_STATUS_READER='SOFTLOAD_PREMIUM_STATUS_READER';
export interface PremiumRecord {
  is_active?: boolean;
  plano?: string;
  premium_ate?: string|null;
}
export interface PremiumStatusReader {
  findByEmail(email:string):Promise<PremiumRecord|null>;
}
export interface PremiumUser extends PremiumRecord {email?:string}
export interface PremiumRequest {session?:{user?:PremiumUser|null}}
export type PremiumDecision =
  | {allow:true}
  | {allow:false;reason:'session'|'inactive'|'expired'};

async function findStatus(reader:PremiumStatusReader,email?:string):Promise<PremiumRecord|null> {
  if(typeof email!=='string'||!email.trim())return null;
  try{return await reader.findByEmail(email.toLowerCase());}
  catch{return null;} // outage must never grant Premium access
}
function restoreSession(user:PremiumUser,record:PremiumRecord):void {
  user.is_active=true;
  user.plano=record.plano||user.plano||'premium';
  if(record.premium_ate)user.premium_ate=record.premium_ate;
}

/**
 * Current Express authorization contract, modeled without I/O beyond an
 * injected reader. Expired sessions must be rechecked after a webhook renewal;
 * unavailable Firestore means deny, never assume payment.
 */
export async function decidePremium(
  req:PremiumRequest,
  reader:PremiumStatusReader,
  now:number=Date.now()
):Promise<PremiumDecision> {
  const user=req.session?.user;
  if(!user)return {allow:false,reason:'session'};
  if(user.premium_ate){
    const expires=Date.parse(user.premium_ate);
    if(Number.isFinite(expires)&&expires<now){
      const record=await findStatus(reader,user.email);
      const renewed=record?.is_active===true && !!record.premium_ate &&
        Number.isFinite(Date.parse(record.premium_ate)) && Date.parse(record.premium_ate)>=now;
      if(renewed){
        restoreSession(user,record);
        return {allow:true};
      }
      user.is_active=false;
      user.plano='free';
      return {allow:false,reason:'expired'};
    }
  }
  if(!user.is_active){
    const record=await findStatus(reader,user.email);
    // Mirrors the legacy inactive-session branch. Enforcing expiry also here
    // needs its own policy change and parity tests before replacing Express.
    if(record?.is_active===true){
      restoreSession(user,record);
      return {allow:true};
    }
    return {allow:false,reason:'inactive'};
  }
  return {allow:true};
}

@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(@Inject(PREMIUM_STATUS_READER) private readonly reader:PremiumStatusReader){}
  async canActivate(context:ExecutionContext):Promise<boolean>{
    const request=context.switchToHttp().getRequest<PremiumRequest>();
    const decision=await decidePremium(request,this.reader);
    if(decision.allow)return true;
    if(decision.reason==='session'){
      throw new AccessContractException('premium',401,{erro:'Sessão expirada. Faça login novamente.'});
    }
    const message=decision.reason==='expired'
      ? 'Sua licença Premium expirou. Renove em /dashboard/upgrade.'
      : 'Recurso disponível apenas no plano Premium. Acesse /dashboard/upgrade.';
    throw new AccessContractException('premium',403,{erro:message,plano_necessario:'premium'});
  }
}
