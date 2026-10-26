'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const runtime=import(pathToFileURL(path.join(__dirname,'procedural.mjs')).href);
test('gerador HTML5: terreno determinístico e limites defensivos',async()=>{
    const {seededRandom,generateTerrain}=await runtime;
    const a=seededRandom(42),b=seededRandom(42);
    assert.deepEqual(Array.from({length:10},()=>a()),Array.from({length:10},()=>b()));
    const opts={width:15,height:12,seed:42,water:.2,forest:.65};
    const terrain=generateTerrain(opts);
    assert.equal(terrain.length,12);
    assert.ok(terrain.every(row=>row.length===15&&row.every(cell=>['water','grass','forest'].includes(cell))));
    assert.deepEqual(terrain,generateTerrain(opts));
    assert.throws(()=>generateTerrain({width:0,height:1}),/dimensions/);
    assert.throws(()=>generateTerrain({width:2000,height:2000}),/dimensions/);
    assert.throws(()=>generateTerrain({width:4,height:4,water:.8,forest:.3}),/thresholds/);
});
test('drawTree mantém desenho Canvas 2D e restaura contexto',async()=>{
    const {drawTree}=await runtime;
    const calls=[];
    const ctx={save:()=>calls.push('save'),restore:()=>calls.push('restore'),
        translate:(x,y)=>calls.push(['translate',x,y]),
        fillRect:(...args)=>calls.push(['rect',...args]),
        beginPath:()=>calls.push('begin'),
        ellipse:(...args)=>calls.push(['ellipse',...args]),
        fill:()=>calls.push('fill')};
    drawTree(ctx,{x:12,y:20,radius:10,seed:8});
    assert.equal(calls[0],'save');
    assert.deepEqual(calls[1],['translate',12,20]);
    assert.equal(calls.filter(x=>x==='begin').length,7);
    assert.equal(calls.filter(x=>x==='fill').length,7);
    assert.equal(calls.at(-1),'restore');
});
