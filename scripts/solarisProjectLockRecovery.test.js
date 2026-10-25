'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCli() {
    const calls = [];
    const messages = [];
    const fakeDb = {mock: true};
    const sandbox = {
        module: {exports: {}}, exports: {},
        process: {argv:['node','solarisProjectLockRecovery.js'],exitCode:0},
        console: {log:x=>messages.push(JSON.parse(x)), error:()=>{}},
        require(id) {
            if(id === '../src/solaris/tools/projectLockRecovery') return {
                REQUIRED_CONFIRMATION:'EXPLICIT_STOPPED',
                async inspectSolarisLock(...args) {calls.push(['inspect',...args]);return null;},
                async recoverSolarisLock(...args) {calls.push(['recover',...args]);return {released:false,reason:'mock'};},
            };
            if(id === 'dotenv') return {config() { calls.push(['dotenv']); }};
            if(id === '../src/services/firebase') return {db:fakeDb};
            throw Error('Unexpected external dependency: '+id);
        },
    };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'solarisProjectLockRecovery.js'),'utf8'),sandbox,{
        filename:'solarisProjectLockRecovery.js',timeout:2000,
    });
    return {main:sandbox.module.exports.main,calls,messages,fakeDb};
}

test('invalid input fails before loading any external service',async()=>{
    const cli=loadCli();
    await assert.rejects(cli.main([]),/Uso:/);
    await assert.rejects(cli.main(['recover','u','s','o','t','--confirm']),/--instances-stopped/);
    await assert.rejects(cli.main(['recover','u','s','o','t','--instances-stopped']),/--confirm/);
    assert.equal(cli.calls.length,0);
});

test('inspection uses read-only operation with mocked database',async()=>{
    const cli=loadCli();
    await cli.main(['inspect','u','s']);
    assert.deepEqual(cli.calls.map(c=>c[0]),['dotenv','inspect']);
    assert.equal(cli.calls[1][1],cli.fakeDb);
    assert.equal(cli.messages[0].status,'unlocked');
});

test('confirmed recovery passes expected fingerprint only to mock',async()=>{
    const cli=loadCli();
    await cli.main(['recover','u','s','owner-1','2026-10-25T02:00:00Z','--instances-stopped','--confirm']);
    assert.deepEqual(cli.calls.map(c=>c[0]),['dotenv','recover']);
    const opts=cli.calls[1][2];
    assert.equal(opts.uid,'u');
    assert.equal(opts.expectedOwner,'owner-1');
    assert.equal(opts.instancesStopped,true);
    assert.equal(opts.confirmation,'EXPLICIT_STOPPED');
    assert.equal(cli.messages[0].released,false);
});
