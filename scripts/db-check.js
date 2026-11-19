import {openDatabase,databaseMode} from '../database.js';
import {resolve} from 'node:path';
let db;
try {
  db=await openDatabase(process.env.DATABASE_PATH||resolve('data/bizassist.db'));
  await db.health();
  for(const table of ['users','sessions','tickets','messages','events','articles']){
    const result=await db.prepare(`SELECT count(*) AS count FROM ${table}`).get();
    console.log(`${table}: ${result.count} rows`);
  }
  console.log(`Connected successfully: ${databaseMode()}`);
}catch(error){console.error('Database check failed. Verify settings and run the migration before connecting.');process.exitCode=1;}
finally {await db?.close();}
