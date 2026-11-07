import 'reflect-metadata';
import {Catch,HttpException} from '@nestjs/common';
import type {ArgumentsHost,ExceptionFilter} from '@nestjs/common';
import {createRequire} from 'node:module';

// No Firebase, HTTP call or commercial routing in the response adapter.
// It reuses the same API-vs-navigation rule as legacy Express.
const require=createRequire(import.meta.url);
const {wantsJson}=require('../../src/middlewares/accessPolicy.js') as {
  wantsJson(request:unknown):boolean;
};

export type AccessScope='session'|'premium';
export class AccessContractException extends HttpException {
  constructor(
    public readonly accessScope:AccessScope,
    status:401|403,
    body:Record<string,unknown>
  ){super(body,status);}
}
interface ExpressResponse {
  status(code:number):ExpressResponse;
  json(payload:unknown):unknown;
  redirect(url:string):unknown;
}

/**
 * Only catches deliberate authorization denials; Nest 404/500, rate limiting
 * and other exceptions remain untouched.
 *
 * HTML navigation preserves Express redirects, while API/fetch requests keep
 * their exact JSON status and body. Register explicitly in Nest bootstrap.
 */
@Catch(AccessContractException)
export class AccessContractFilter implements ExceptionFilter<AccessContractException> {
  catch(exception:AccessContractException,host:ArgumentsHost):void {
    const http=host.switchToHttp();
    const request=http.getRequest<unknown>();
    const response=http.getResponse<ExpressResponse>();

    if(wantsJson(request)){
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    const redirect=exception.accessScope==='premium' && exception.getStatus()===403
      ? '/dashboard/upgrade'
      : '/login?erro=Faça login para continuar.';
    response.redirect(redirect);
  }
}
