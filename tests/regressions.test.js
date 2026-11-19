import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp,startServer} from '../server.js';
import {chat,analyze} from '../ai.js';

test('malformed and empty provider message content uses the offline fallback',async()=>{
  const originalFetch=globalThis.fetch;
  const old={provider:process.env.AI_PROVIDER,key:process.env.AI_API_KEY};
  process.env.AI_PROVIDER='openai-compatible';process.env.AI_API_KEY='test-only';
  try{
    for(const content of [42,{},[],null,'   ']){
      globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})});
      assert.equal((await chat('refund',[{id:1,title:'Refund',content:'Open a billing ticket.'}])).source,'Offline knowledge search');
      assert.equal((await analyze({subject:'Refund',body:'Help with a refund'},[])).source,'Offline assistant');
    }
  }finally{globalThis.fetch=originalFetch;for(const [key,value] of [['AI_PROVIDER',old.provider],['AI_API_KEY',old.key]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('invalid IDs, absent articles and malformed origins return client errors',async()=>{
  const {server,db}=await createApp(':memory:',true,{provider:'sqlite'});const port=await startServer(server,{port:0});const base=`http://127.0.0.1:${port}/api`;
  try{
    const auth=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@bizassist.demo',password:'BizAssist123!'})});
    const cookie=auth.headers.get('set-cookie').split(';')[0];
    const request=(path,method,body,headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie,...headers},body:JSON.stringify(body)});
    for(const id of [null,{},[],true,'1',-1,1.5]){
      assert.equal((await request('/users','PATCH',{id,role:'staff'})).status,400);
      assert.equal((await request('/articles','DELETE',{id})).status,400);
    }
    assert.equal((await request('/articles','DELETE',{id:9999})).status,404);
    assert.equal((await request('/articles','PATCH',{id:9999,title:'Missing',category:'General',content:'Missing'})).status,404);
    assert.equal((await request('/tickets/1','PATCH',{assignee_id:{}})).status,400);
    assert.equal((await request('/logout','POST',{}, {Origin:'null'})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('busy default port selects a free port and explicit ports fail clearly',async()=>{
  const occupied=createServer(),fallback=createServer(),explicit=createServer();
  try{
    const port=await startServer(occupied,{port:0});
    assert.notEqual(await startServer(fallback,{port}),port);
    await assert.rejects(startServer(explicit,{port,fallback:false}),{code:'EADDRINUSE'});
    await assert.rejects(startServer(explicit,{port:NaN}),/PORT must/);
  }finally{await Promise.all([occupied,fallback].map(s=>new Promise(r=>s.close(r))));}
});
