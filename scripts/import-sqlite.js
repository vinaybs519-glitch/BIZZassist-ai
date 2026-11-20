import {DatabaseSync} from 'node:sqlite';
import {Pool} from 'pg';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {postgresConfig} from '../database.js';

const tables={users:['id','name','email','password','role'],articles:['id','title','category','content'],tickets:['id','subject','body','customer_id','assignee_id','status','priority','category','summary','suggestion','ai_source','created_at','updated_at'],messages:['id','ticket_id','user_id','body','created_at'],events:['id','ticket_id','actor','description','created_at']};
export async function importSQLite(source,client){
  await client.query('BEGIN');
  try{
    await client.query('SET search_path = public, bizassist');
    await client.query('LOCK TABLE users,articles,tickets,messages,events,sessions IN ACCESS EXCLUSIVE MODE');
    for(const table of [...Object.keys(tables),'sessions']){
      if(Number((await client.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count)!==0)throw Error('Import requires empty target tables. Use a new Supabase database/schema; existing data will not be overwritten.');
    }
    let total=0;
    for(const [table,columns] of Object.entries(tables)){
      for(const row of source.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY id`).all()){
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(c=>row[c]));total++;
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE((SELECT MAX(id) FROM ${table}),1),(SELECT count(*)>0 FROM ${table}))`);
    }
    await client.query('COMMIT');return total;
  }catch(error){await client.query('ROLLBACK');throw error;}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let source,pool,client;
  try{
    const path=resolve(process.argv[2]||process.env.DATABASE_PATH||'data/bizassist.db');
    if(!existsSync(path))throw Error('Source SQLite database does not exist.');
    source=new DatabaseSync(path,{readOnly:true});pool=new Pool(postgresConfig());client=await pool.connect();
    console.log(`Imported ${await importSQLite(source,client)} records. Existing password hashes were preserved; users must sign in again.`);
  }catch(error){console.error(error.message.startsWith('Import requires')||error.message==='Source SQLite database does not exist.'?error.message:'Import failed. Nothing was committed. Check connection settings and the target schema.');process.exitCode=1;}
  finally{client?.release();await pool?.end();source?.close();}
}
