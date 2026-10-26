'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'contatoRoutes.js'),'utf8');
function fixture({failMail=false}={}) {
    const requests=[],mail=[],router={
        get(url,handler){requests.push({method:'get',url,handler});},
        post(url,limiter,handler){requests.push({method:'post',url,limiter,handler});}
    };
    let limitConfig;
    const module={exports:{}};
    const imports={
        express:{Router(){return router;}},
        'express-rate-limit':(config)=>{limitConfig=config;return {tag:'rate-limit'};},
        '../services/emailService':{transporter:{async sendMail(options){
            mail.push(options);
            if(failMail)throw Error('SMTP down');
        }}}
    };
    vm.runInNewContext(source,{
        module,exports:{},console:{log(){},error(){}},
        require(name){if(!Object.hasOwn(imports,name))throw Error('Unexpected import '+name);return imports[name];}
    },{filename:'contatoRoutes.js'});
    const post=requests.find(x=>x.method==='post');
    const get=requests.find(x=>x.method==='get');
    function res(){const result={url:null,rendered:null};return {result,redirect(url){result.url=url;},render(name,context){result.rendered={name,context};}};}
    return {post,get,mail,limitConfig,res,requests,module:module.exports};
}
test('GET mantém formulário, sessão e parâmetros de feedback',()=>{
    const f=fixture(),res=f.res();
    f.get.handler({session:{user:{email:'test@example.test'}},query:{erro:'E',sucesso:'S'}},res);
    assert.equal(f.get.url,'/contato');
    assert.equal(res.result.rendered.name,'pages/contato');
    assert.equal(res.result.rendered.context.user.email,'test@example.test');
    assert.equal(res.result.rendered.context.erro,'E');
    assert.equal(res.result.rendered.context.sucesso,'S');
});
test('limite mantém uma mensagem por IP por minuto',()=>{
    const f=fixture(),res=f.res();
    assert.equal(f.limitConfig.max,1);
    assert.equal(f.limitConfig.windowMs,60000);
    assert.equal(f.limitConfig.standardHeaders,true);
    assert.equal(f.limitConfig.legacyHeaders,false);
    f.limitConfig.handler({},res);
    assert.match(res.result.url,/Aguarde 1 minuto/);
});
test('formulário rejeita campos vazios, nomes, e-mails, markup e excesso de palavras antes do SMTP',async()=>{
    const f=fixture();
    const valid={nome:'Cliente Exemplo',email:'teste@example.test',mensagem:'Olá, tudo bem?'};
    for(const body of [
        {...valid,nome:''},
        {...valid,nome:'123'},
        {...valid,email:'invalido'},
        {...valid,mensagem:'<script>alert(1)</script>'},
        {...valid,mensagem:Array.from({length:101},()=> 'abc').join(' ')}
    ]){
        const res=f.res();
        await f.post.handler({body},res);
        assert.match(res.result.url,/^\/contato\?erro=/);
    }
    assert.equal(f.mail.length,0);
});
test('envia mensagem válida com destinatário esperado e não vaza falha SMTP',async()=>{
    const f=fixture();const res=f.res();
    await f.post.handler({body:{nome:'  Maria Silva  ',email:'  maria@example.test ',mensagem:'  Olá pessoal!  '}},res);
    assert.equal(f.mail.length,1);
    assert.equal(f.mail[0].to,'softload@proton.me');
    assert.equal(f.mail[0].subject,'[Contato] Nova mensagem de Maria Silva');
    assert.match(f.mail[0].html,/Olá pessoal!/);
    assert.match(res.result.url,/sucesso=/);
    const down=fixture({failMail:true}),failed=down.res();
    await down.post.handler({body:{nome:'Maria Silva',email:'maria@example.test',mensagem:'Olá pessoal!'}},failed);
    assert.match(failed.result.url,/Falha ao enviar/);
});

test('aceita pontuação comum no contato e orienta sem mensagem enganosa',async()=>{
    const f=fixture(),res=f.res();
    await f.post.handler({body:{nome:'Ana Silva',email:'ana@example.test',
        mensagem:'Olá, tudo bem? Preciso de ajuda com CSS: color #fff; e widgets (Blogger).'}},res);
    assert.equal(f.mail.length,1);
    assert.match(res.result.url,/sucesso=/);
    const rejected=f.res();
    await f.post.handler({body:{nome:'Ana Silva',email:'ana@example.test',
        mensagem:'<script>alert(1)</script>'}},rejected);
    assert.match(rejected.result.url,/sem código HTML/);
});
