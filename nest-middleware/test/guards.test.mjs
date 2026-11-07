import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Controller,Get,Module,UseGuards} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {MiddlewareModule} from '../dist/middleware.module.js';
import {SessionGuard,SuperAdminGuard,WorkerGuard} from '../dist/guards.js';
import {PremiumGuard} from '../dist/premium.js';
import {PremiumAccessModule} from '../dist/premium.module.js';

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
  premium(){return {ok:true,scope:'premium'};}
}
Controller('api/nest-proof')(ProbeController);
for(const [method,path,Guard] of [
  ['session','session',SessionGuard],
  ['admin','admin',SuperAdminGuard],
  ['worker','worker',WorkerGuard],
  ['premium','premium',PremiumGuard]
]){
  const descriptor=Object.getOwnPropertyDescriptor(ProbeController.prototype,method);
  Get(path)(ProbeController.prototype,method,descriptor);
  UseGuards(Guard)(ProbeController.prototype,method,descriptor);
}
const premiumReader={
  async findByEmail(email){
    if(email==='offline@example.com')throw Error('mock Firestore unavailable');
    if(email==='paid@example.com')
      return {is_active:true,plano:'essencial',premium_ate:'2030-01-01T00:00:00.000Z'};
    return null;
  }
};
class ProbeModule {}
Module({imports:[MiddlewareModule,PremiumAccessModule.register(premiumReader)],controllers:[ProbeController]})(ProbeModule);
test('Nest HTTP guard chain enforces 401 / concealed 404 / permitted 200',async()=>{
  const app=await NestFactory.create(ProbeModule,{logger:['error'],abortOnError:false});
  app.use((req,_res,next)=>{
    const fixture=req.headers['x-test-session'];
    req.session=fixture==='user' ? {user:{uid:'test'}} :
      fixture==='admin' ? {user:{uid:'test',is_super_admin:true}} :
      fixture==='worker' ? {user:{uid:'test',email:'SOFTLOADY@GMAIL.COM'}} :
      fixture==='paid' ? {user:{email:'paid@example.com',is_active:true,premium_ate:'2030-01-01T00:00:00.000Z'}} :
      fixture==='renewed' ? {user:{email:'paid@example.com',is_active:true,premium_ate:'2020-01-01T00:00:00.000Z'}} :
      fixture==='inactive' ? {user:{email:'paid@example.com',is_active:false}} :
      fixture==='expired' ? {user:{email:'old@example.com',is_active:true,premium_ate:'2020-01-01T00:00:00.000Z'}} :
      fixture==='outage' ? {user:{email:'offline@example.com',is_active:false}} :
      fixture==='free' ? {user:{email:'free@example.com',is_active:false}} : {};
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
    assert.equal((await get('/api/nest-proof/premium')).status,401);
    assert.equal((await get('/api/nest-proof/premium','free')).status,403);
    assert.equal((await get('/api/nest-proof/premium','paid')).status,200);
    assert.equal((await get('/api/nest-proof/premium','renewed')).status,200);
    assert.equal((await get('/api/nest-proof/premium','inactive')).status,200);
    assert.equal((await get('/api/nest-proof/premium','expired')).status,403);
    assert.equal((await get('/api/nest-proof/premium','outage')).status,403);
    assert.equal((await get('/api/nest-proof/does-not-exist')).status,404);
  }finally{await app.close();}
});
