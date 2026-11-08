import 'reflect-metadata';
import {Catch,HttpException} from '@nestjs/common';
import type {ArgumentsHost,ExceptionFilter} from '@nestjs/common';
import {createRequire} from 'node:module';
import {AccessContractException,AccessContractFilter} from './response-contract.js';

// Explicitly opt-in ONLY on the offline Express 5 / Nest shared-app pilot.
// The commercial Express 4 server continues to mount its own real fallback.
const require=createRequire(import.meta.url);
const {wantsJson}=require('../../src/middlewares/accessPolicy.js') as {
  wantsJson(request:unknown):boolean;
};
interface ErrorResponse {
  status(code:number):ErrorResponse;
  json(payload:unknown):unknown;
  render(view:string):unknown;
}

/**
 * Nest owns final 404s only after the Express legacy error handler has been
 * mounted without its early 404 catch-all. Match commercial EJS/JSON error
 * responses while keeping deliberate authorization redirects untouched.
 */
@Catch()
export class LegacyErrorContractFilter implements ExceptionFilter {
  private readonly access=new AccessContractFilter();

  catch(exception:unknown,host:ArgumentsHost):void {
    if(exception instanceof AccessContractException){
      this.access.catch(exception,host);
      return;
    }
    const http=host.switchToHttp();
    const request=http.getRequest<unknown>();
    const response=http.getResponse<ErrorResponse>();
    const status=exception instanceof HttpException?exception.getStatus():500;

    // Legacy Express renders pages/404 even for unknown /api/* routes.
    // Do not normalize these to Nest's default JSON 404 during migration.
    if(status===404){
      response.status(404).render('pages/404');
      return;
    }
    if(status>=500){
      if(wantsJson(request)){
        response.status(status).json({erro:'Erro interno do servidor. Tente novamente.'});
      }else{
        response.status(status).render('pages/404');
      }
      return;
    }

    // Ordinary Nest 4xx errors remain ordinary Nest JSON responses:
    // auth, validation and rate-limit failures are not disguised as 500s.
    if(exception instanceof HttpException){
      const body=exception.getResponse();
      response.status(status).json(typeof body==='object'&&body!==null
        ?body:{statusCode:status,message:body});
      return;
    }
    response.status(500).json({erro:'Erro interno do servidor. Tente novamente.'});
  }
}
