import {createClient} from '@supabase/supabase-js';

export function publicSupabaseConfig(env=process.env){
  const url=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL;
  const key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw Error('Set the Supabase project URL and publishable key in .env.local.');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.pathname!=='/'||parsed.username||parsed.password)throw Error('Use the HTTPS Supabase project root URL, without /rest/v1/.');
  if(!key.startsWith('sb_publishable_'))throw Error('This client requires a publishable key, never a secret or service-role key.');
  return {url:parsed.origin,key};
}

// A fresh anonymous client per call prevents sharing user sessions across requests.
// BizAssist retains its own HttpOnly session authentication for the private database.
export function createPublicSupabaseClient(env=process.env){
  const {url,key}=publicSupabaseConfig(env);
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:options?.signal||AbortSignal.timeout(10000)})}});
}

export async function inspectSupabaseConnection(env=process.env,fetcher=fetch){
  const {url,key}=publicSupabaseConfig(env);
  const result={projectUrl:url,apiConnected:false,authReachable:false,databaseConfigured:Boolean(env.SUPABASE_DB_URL),activeDatabase:env.DATABASE_PROVIDER||'sqlite'};
  // OpenAPI discovery at /rest/v1/ requires a secret key on this project.
  // A zero-row query to the user's sample table verifies normal Data API access.
  for(const [path,field] of [['/rest/v1/todos?select=id&limit=0','apiConnected'],['/auth/v1/settings','authReachable']]){
    try{const response=await fetcher(url+path,{headers:{apikey:key},signal:AbortSignal.timeout(10000)});result[field]=response.ok;result[field+'Status']=response.status;}
    catch{result[field+'Status']='unreachable';}
  }
  return result;
}
