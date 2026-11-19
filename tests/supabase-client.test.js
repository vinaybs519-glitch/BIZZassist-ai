import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicSupabaseConfig,inspectSupabaseConnection,createPublicSupabaseClient} from '../supabase-client.js';
const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
test('public Supabase helper accepts project roots and rejects secret keys and API paths',()=>{
  assert.equal(publicSupabaseConfig(env).url,'https://example.supabase.co');
  assert.throws(()=>publicSupabaseConfig({...env,NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/'}),/root URL/);
  assert.throws(()=>publicSupabaseConfig({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'}),/publishable key/);
  assert.throws(()=>publicSupabaseConfig({}),/Set the Supabase/);
  assert.notEqual(createPublicSupabaseClient(env),createPublicSupabaseClient(env));
});
test('connection diagnostics distinguish API connectivity from ticket database storage',async()=>{
  const urls=[];
  const result=await inspectSupabaseConnection(env,async(url,options)=>{urls.push(url);assert.equal(options.headers.apikey,'sb_publishable_test');return {ok:true,status:200};});
  assert.equal(result.apiConnected,true);assert.equal(result.authReachable,true);assert.equal(result.activeDatabase,'sqlite');assert.equal(result.databaseConfigured,false);
  assert.ok(urls[0].includes('limit=0'));assert.ok(!JSON.stringify(result).includes('sb_publishable_test'));
});
test('connection diagnostics report permission errors and outages without throwing',async()=>{
  const denied=await inspectSupabaseConnection(env,async()=>({ok:false,status:403}));assert.equal(denied.apiConnected,false);assert.equal(denied.apiConnectedStatus,403);
  const offline=await inspectSupabaseConnection(env,async()=>{throw Error('offline');});assert.equal(offline.authReachableStatus,'unreachable');
});
