import {openDatabase} from '../database.js';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const email=process.argv[2]?.trim().toLowerCase();
if(!email){console.error('Usage: node scripts/promote-admin.js registered-email@example.com');process.exit(1);}
const db=await openDatabase(process.env.DATABASE_PATH||resolve(root,'data/bizassist.db'));
const result=await db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email);
await db.close();
if(!result.changes){console.error('No registered account matches that email.');process.exit(1);}
console.log('Administrator role assigned. Sign in with your existing password.');
