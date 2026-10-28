import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.js';

test('Worker only permits explicit unauthenticated development; production always fails closed', async () => {
  const snapshot = {...process.env};
  try {
    for (const [env, flag, expected] of [
      ['production','true',503], ['development','false',503],
      ['test','true',200], ['development','true',200], ['', 'true',503],
    ]) {
      delete process.env.WORKER_SHARED_SECRET;
      process.env.NODE_ENV=env; process.env.WORKER_ALLOW_UNAUTHENTICATED=flag;
      const app=createApp({execute:async()=>({ok:true,result:[]})});
      const server=app.listen(0,'127.0.0.1');
      await new Promise(resolve=>server.once('listening',resolve));
      const url='http://127.0.0.1:'+server.address().port;
      try {
        assert.equal((await fetch(url+'/capabilities')).status,expected);
        assert.equal((await fetch(url+'/run',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({request_id:'auth-test',task:'execute',actions:[{id:'a',capability:'forge',operation:'catalog',input:{}}]})})).status,expected);
        assert.equal((await fetch(url+'/escalations/id/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,expected);
      } finally { await new Promise(resolve=>server.close(resolve)); }
    }
  } finally { process.env=snapshot; }
});
