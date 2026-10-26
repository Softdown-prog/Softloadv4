'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'conta.js'), 'utf8');
function fixture({authFails=false,storageFails=false,dbFails=false,empty=false} = {}) {
    const events=[];
    let route, guard;
    const user={uid:'uid-001',email:'User@Example.Test'};
    const router={post(p,middleware,handler) {
        assert.equal(p,'/dashboard/conta/excluir');
        guard=middleware;route=handler;
    }};
    const exigirLogin=()=>{};
    const db={collection(name) {
        events.push('collection:'+name);
        if(name==='clientes_premium') return {
            where(field,op,email) {
                assert.deepEqual([field,op,email],['email','==','user@example.test']);
                return {limit(n) {
                    assert.equal(n,1);
                    return {async get() {
                        events.push('query');
                        if(dbFails)throw Error('Firestore unavailable');
                        return {empty,docs:empty?[]:[{ref:{async delete(){events.push('delete-premium');}}}]};
                    }};
                }};
            }
        };
        if(name==='usuarios') return {doc(email) {
            assert.equal(email,'user@example.test');
            return {async delete(){events.push('delete-usuarios');}};
        }};
        throw Error('Unexpected collection '+name);
    }};
    const storage={async deletarTodosArquivos(uid) {
        assert.equal(uid,user.uid);
        events.push('delete-storage');
        if(storageFails)throw Error('GCS unavailable');
    }};
    const auth={async deleteUser(uid) {
        assert.equal(uid,user.uid);
        events.push('delete-auth');
        if(authFails)throw Error('Auth unavailable');
    }};
    const module={exports:{}};
    const imports={
        'express':{Router:()=>router},
        '../../middlewares/authGuard':{exigirLogin},
        '../../services/firebase':{db,auth},
        '../../services/storageService':storage
    };
    vm.runInNewContext(source,{
        module,exports:{},
        require(name){if(!(name in imports))throw Error('Unexpected dependency '+name);return imports[name];},
        console:{error(){events.push('error-log');}}
    },{filename:'conta.js'});
    assert.equal(module.exports,router);
    assert.equal(guard,exigirLogin);
    return {events,async run(confirmation='EXCLUIR') {
        let url;
        const req={
            body:{confirmacao:confirmation},
            session:{user,destroy(callback){events.push('destroy-session');callback();}}
        };
        const res={redirect(path){events.push('redirect');url=path;}};
        await route(req,res);
        return url;
    }};
}
test('sem confirmação não apaga dados, nem encerra sessão',async()=>{
    const f=fixture();
    assert.equal(await f.run('não'),'/dashboard/configuracoes?erro=confirmacao');
    assert.deepEqual(f.events,['redirect']);
});
test('com confirmação preserva sequência de exclusão e encerra sessão',async()=>{
    const f=fixture();
    assert.equal(await f.run(), '/?conta=apagada');
    assert.deepEqual(f.events,[
        'delete-storage','delete-auth','collection:clientes_premium','query',
        'delete-premium','collection:usuarios','delete-usuarios','destroy-session','redirect'
    ]);
});
test('sem registro premium segue removendo usuário e sessão',async()=>{
    const f=fixture({empty:true});
    assert.equal(await f.run(), '/?conta=apagada');
    assert.equal(f.events.includes('delete-premium'),false);
});
test('falha de limpeza GCS não impede remoção da conta',async()=>{
    const f=fixture({storageFails:true});
    assert.equal(await f.run(), '/?conta=apagada');
    assert.equal(f.events.includes('delete-auth'),true);
});
test('falha de Auth impede falso sucesso e mantém sessão',async()=>{
    const f=fixture({authFails:true});
    assert.equal(await f.run(), '/dashboard/configuracoes?erro=exclusao');
    assert.equal(f.events.includes('destroy-session'),false);
    assert.equal(f.events.includes('collection:clientes_premium'),false);
});
test('erro na consulta Firestore mostra falha sem encerrar sessão',async()=>{
    const f=fixture({dbFails:true});
    assert.equal(await f.run(), '/dashboard/configuracoes?erro=exclusao');
    assert.equal(f.events.includes('destroy-session'),false);
});
