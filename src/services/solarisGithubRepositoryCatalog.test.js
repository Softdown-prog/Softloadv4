'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {listGithubRepositories}=require('./solarisGithubRepositoryCatalog');
test('lista apenas repositórios autorizados sem expor token',async()=>{
 const calls=[];
 const mock=async(url,opt)=>{
  calls.push(url);assert.equal(opt.headers.Authorization,'Bearer user-token');
  if(url.includes('/user/installations?'))return {ok:true,json:async()=>({installations:[{id:7}]})};
  return {ok:true,json:async()=>({repositories:[{full_name:'alice/demo',private:true,permissions:{push:true}}]})};
 };
 const result=await listGithubRepositories('user-token',mock);
 assert.deepEqual(result.repositories,[{name:'alice/demo',private:true,canPush:true}]);
 assert.equal(result.truncated,false);assert.equal(calls.length,2);
 assert.ok(!JSON.stringify(result).includes('user-token'));
});
test('falha fechado com token ausente ou erro de API',async()=>{
 await assert.rejects(()=>listGithubRepositories(''),/Reconecte/);
 await assert.rejects(()=>listGithubRepositories('user-token',async()=>({ok:false})),/listar/);
});
