import {inspectSupabaseConnection,createPublicSupabaseClient} from '../supabase-client.js';
try {
  const result=await inspectSupabaseConnection();
  console.log(JSON.stringify(result,null,2));
  if(result.authReachable){
    // The user-provided sample names todos. Probe metadata only, never fetch row contents.
    const {error,status}=await createPublicSupabaseClient().from('todos').select('id').limit(0);
    console.log(JSON.stringify({sampleTable:'todos',status,available:!error,errorCode:error?.code||null}));
    if(error?.code==='PGRST205')console.log('The example todos table does not exist. No data was created or modified.');
  }
  console.log('API connectivity does not establish access to the private BizAssist database.');
  if(!result.apiConnected||!result.authReachable)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
