'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const api=import(pathToFileURL(path.join(__dirname,'runtime.mjs')).href);

test('loop limita catch-up, evita start duplicado e cancela frame ao parar',async()=>{
 const {createLoop}=await api;
 const frames=[],cancelled=[],steps=[],renders=[];
 const loop=createLoop({update:v=>steps.push(v),render:v=>renders.push(v),hz:10,maxSteps:3,
  requestFrame:cb=>{frames.push(cb);return frames.length;},
  cancelFrame:id=>cancelled.push(id)});
 loop.start();loop.start();assert.equal(frames.length,1);
 frames[0](1000);assert.equal(steps.length,0);
 frames[1](5000);assert.equal(steps.length,3);assert.equal(renders.at(-1),0);
 loop.stop();assert.equal(cancelled.length,1);
 const count=frames.length;frames.at(-1)(6000);assert.equal(frames.length,count);
 assert.throws(()=>createLoop({update(){},render(){},hz:0}),/loop configuration/);
});
test('input limpa teclas e ponteiros e remove listeners',async()=>{
 const {createInput}=await api;
 function target(){
  const handlers=new Map();return {handlers,tabIndex:-1,
   addEventListener(k,fn){handlers.set(k,fn);},
   removeEventListener(k,fn){if(handlers.get(k)===fn)handlers.delete(k);},
   focus(){},setPointerCapture(){}};
 }
 const win=target(),element=target();element.ownerDocument={defaultView:win};
 const input=createInput(element);
 assert.equal(element.tabIndex,0);
 let prevented=false;
 element.handlers.get('keydown')({code:'KeyW',preventDefault(){prevented=true;}});
 assert.equal(input.down('up'),true);assert.equal(prevented,true);
 element.handlers.get('pointerdown')({pointerId:42,offsetX:7,offsetY:9});
 assert.equal(input.pointers.get(42).x,7);
 element.handlers.get('pointermove')({pointerId:42,offsetX:11,offsetY:13});
 assert.equal(input.pointers.get(42).y,13);
 element.handlers.get('pointerup')({pointerId:42});
 assert.equal(input.pointers.size,0);
 win.handlers.get('blur')();
 assert.equal(input.down('up'),false);
 input.destroy();
 assert.equal(element.handlers.size,0);assert.equal(win.handlers.size,0);
});
test('coordenadas isométricas, interseção e colisão preservam contrato',async()=>{
 const {isoToScreen,screenToIso,intersects,moveAndCollide}=await api;
 const p=isoToScreen(4,2); assert.deepEqual(screenToIso(p.x,p.y),{x:4,y:2});
 assert.equal(intersects({x:0,y:0,width:2,height:2},{x:2,y:0,width:2,height:2}),false);
 assert.equal(intersects({x:0,y:0,width:2,height:2},{x:1,y:0,width:2,height:2}),true);
 const body={x:0,y:0,width:2,height:2,tag:'hero'};
 const out=moveAndCollide(body,5,0,[{x:3,y:0,width:2,height:2}]);
 assert.equal(out.x,1);assert.equal(out.tag,'hero');assert.equal(body.x,0);
});
test('animação por duração e fitCanvas mantêm âncora e escala',async()=>{
 const {drawAnimation,fitCanvas}=await api;
 const images=[],draws=[];
 const ctx={save(){},restore(){},drawImage(...args){images.push(args)},setTransform(...args){draws.push(args)}};
 const sheet={},anim={frames:[{durationMs:100,rect:[0,0,8,8]},{durationMs:200,rect:[8,0,8,8]}],loop:false,anchor:[2,3],pixelArt:true};
 drawAnimation(ctx,sheet,anim,150,20,30);
 assert.deepEqual(images[0],[sheet,8,0,8,8,18,27,8,8]);
 assert.equal(ctx.imageSmoothingEnabled,false);
 assert.throws(()=>drawAnimation(ctx,sheet,{frames:[]},0,0,0),/no frames/);
 const canvas={style:{},getContext:()=>ctx,width:0,height:0};
 assert.equal(fitCanvas(canvas,100,50,3),ctx);assert.equal(canvas.width,200);
 assert.equal(canvas.style.height,'50px');assert.deepEqual(draws[0],[2,0,0,2,0,0]);
});
