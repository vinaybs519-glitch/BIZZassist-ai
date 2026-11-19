import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {postgresConfig} from '../database.js';
let pool;
try {
  pool=new Pool(postgresConfig());
  const client=await pool.connect();
  try {await client.query(readFileSync(new URL('../supabase/migrations/001_bizassist.sql',import.meta.url),'utf8'));}
  finally {client.release();}
  console.log('Supabase schema is ready. Run npm run db:check, then npm start.');
} catch {console.error('Migration failed. Check SUPABASE_DB_URL, TLS settings and database-owner permissions. No credentials have been printed.');process.exitCode=1;}
finally {await pool?.end();}
