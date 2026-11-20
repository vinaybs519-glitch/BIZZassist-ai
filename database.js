import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export function databaseMode(env=process.env){
  const mode=env.DATABASE_PROVIDER||(process.env.VERCEL ? 'supabase' : 'sqlite');
  if(!['sqlite','supabase'].includes(mode))throw Error('DATABASE_PROVIDER must be sqlite or supabase');
  return mode;
}

export function postgresConfig(env=process.env){
  if(!env.SUPABASE_DB_URL)throw Error('SUPABASE_DB_URL is missing. Please add SUPABASE_DB_URL to your Vercel Environment Variables.');
  let url;try{url=new URL(env.SUPABASE_DB_URL);}catch{throw Error('SUPABASE_DB_URL must be a PostgreSQL connection string.');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password)throw Error('SUPABASE_DB_URL must include a PostgreSQL host, username and password.');
  // URL SSL flags override pg's SSL object; enforce verification in one place.
  for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  const rejectUnauthorized = env.SUPABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? false : true;
  return {connectionString:url.toString(),ssl:{rejectUnauthorized,...(env.SUPABASE_SSL_CA_PATH?{ca:readFileSync(resolve(env.SUPABASE_SSL_CA_PATH),'utf8')}:{})},max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,statement_timeout:15000,application_name:'bizassist',options:'-c search_path=public,bizassist'};
}

// Only static application SQL reaches this adapter; values remain bound parameters.
export function postgresSQL(sql){
  let index=0;
  sql=sql.replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/g,'CURRENT_TIMESTAMP');
  return sql.replace(/'(?:''|[^'])*'|\?/g,token=>token==='?'?`$${++index}`:token);
}

export function postgresAdapter(pool){
  return {
    provider:'supabase',
    prepare(sql){
      const text=postgresSQL(sql);
      return {
        async get(...values){return (await pool.query(text,values)).rows[0];},
        async all(...values){return (await pool.query(text,values)).rows;},
        async run(...values){
          const returnsId=/^\s*INSERT\s+INTO\s+(users|tickets|messages|events|articles)\b/i.test(text);
          const result=await pool.query(text+(returnsId?' RETURNING id':''),values);
          return {changes:result.rowCount,lastInsertRowid:result.rows[0]?.id};
        }
      };
    },
    exec:sql=>pool.query(sql),
    async health(){await pool.query('SELECT 1 FROM users LIMIT 1');return true;},
    close:()=>pool.end()
  };
}

export async function openDatabase(path,options={}){
  const provider=options.provider||databaseMode();
  if(provider==='sqlite'){
    if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
    const {DatabaseSync} = await import('node:sqlite');
    const db=new DatabaseSync(path);db.provider='sqlite';db.health=()=>{db.prepare('SELECT 1').get();return true;};return db;
  }
  if(provider!=='supabase')throw Error('Unsupported database provider');
  const {Pool}=await import('pg');
  const pool=new Pool(postgresConfig());
  pool.on('error',()=>console.error('Supabase connection interrupted. Check connectivity and project status.'));
  const db=postgresAdapter(pool);
  try{await db.health();return db;}catch(error){await db.close();throw Error(error.code==='42P01'||error.code==='3F000'?'Supabase schema is missing. Run npm run db:migrate.':'Unable to connect to Supabase. Check the connection string, project status, network access and TLS certificate.');}
}
