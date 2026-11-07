import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Controller,Get,Module,UseGuards} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {MiddlewareModule} from '../dist/middleware.module.js';
import {SessionGuard,SuperAdminGuard,WorkerGuard} from '../dist/guards.js';

// Genuine Nest dependency injection: proves the providers are registered.
test('Nest module resolves all three scoped guard providers',async()=>{
  const context=await NestFactory.createApplicationContext(MiddlewareModule,{logger:false});
  try {
    for(const Guard of [SessionGuard,SuperAdminGuard,WorkerGuard]){
      assert.ok(context.get(Guard) instanceof Guard);
    }
  }finally{await context.close();}
});

// The route and fake session injector below live ONLY in the test fixture.
// No production server, no real credential, Firestore or Mercado Pago call.
class ProbeController {
  session(){return {ok:true,scope:'session'};}
  admin(){return {ok:true,scope:'admin'};}
  worker(){return {ok:true,scope:'worker'};}
}
Controller('api/nest-proof')(ProbeController);
for(const [method,path,Guard] of [
  ['session','session',SessionGuard],
  ['admin','admin',SuperAdminGuard],
  ['worker','worker',WorkerGuard]
]){
  const descriptor=Object.getOwnPropertyDescriptor(ProbeController.prototype,method);
  Get(path)(ProbeController.prototype,method,descriptor);
  UseGuards(Guard)(ProbeController.prototype,method,descriptor);
}
class ProbeModule {}
Module({imports:[MiddlewareModule],controllers:[ProbeController]})(ProbeModule);
test('Nest HTTP guard chain enforces 401 / concealed 404 / permitted 200',async()=>{
  const app=await NestFactory.create(ProbeModule,{logger:false});
  app.use((req,_res,next)=>{
    const fixture=req.headers['x-test-session'];
    req.session=fixture==='user' ? {user:{uid:'test'}} :
      fixture==='admin' ? {user:{uid:'test',is_super_admin:true}} :
      fixture==='worker' ? {user:{uid:'test',email:'SOFTLOADY@GMAIL.COM'}} : {};
    next();
  });
  try {
    await app.listen(0,'127.0.0.1');
    const addr=app.getHttpServer().address();
    assert.ok(addr&&typeof addr!=='string');
    const base='http://127.0.0.1:'+addr.port;
    const get=async (url,role)=>fetch(base+url,{headers:role?{'x-test-session':role}:{}});
    assert.equal((await get('/api/nest-proof/session')).status,401);
    assert.equal((await get('/api/nest-proof/session','user')).status,200);
    assert.equal((await get('/api/nest-proof/admin')).status,404);
    assert.equal((await get('/api/nest-proof/admin','user')).status,404);
    assert.equal((await get('/api/nest-proof/admin','admin')).status,200);
    assert.equal((await get('/api/nest-proof/worker','user')).status,404);
    assert.equal((await get('/api/nest-proof/worker','worker')).status,200);
    assert.equal((await get('/api/nest-proof/does-not-exist')).status,404);
  }finally{await app.close();}
});
