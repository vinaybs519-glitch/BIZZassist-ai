import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {postgresAdapter,postgresConfig,postgresSQL,databaseMode} from '../database.js';
import {createApp,startServer} from '../server.js';
import {importSQLite} from '../scripts/import-sqlite.js';

const migration=readFileSync(new URL('../supabase/migrations/001_bizassist.sql',import.meta.url),'utf8');
async function fixture(){
  const pg=new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await pg.exec(migration);await pg.exec('SET search_path=public,bizassist');
  const client={async query(text,values){const result=await pg.query(text,values);return {...result,rowCount:result.affectedRows??result.rows.length};},end:()=>pg.close()};
  return {pg,client,db:postgresAdapter(client)};
}
test('PostgreSQL adapter binds values and enforces verified TLS configuration',()=>{
  assert.equal(postgresSQL("SELECT '?' AS literal FROM users WHERE id=? AND email=?"),"SELECT '?' AS literal FROM users WHERE id=$1 AND email=$2");
  assert.match(postgresSQL("UPDATE tickets SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"),/CURRENT_TIMESTAMP WHERE id=\$1/);
  assert.throws(()=>postgresConfig({}),/SUPABASE_DB_URL/);
  assert.throws(()=>databaseMode({DATABASE_PROVIDER:'typo'}),/DATABASE_PROVIDER/);
  const config=postgresConfig({SUPABASE_DB_URL:'postgresql://postgres:secret@example.com:5432/postgres?sslmode=disable'});
  assert.equal(config.ssl.rejectUnauthorized,true);assert.ok(!config.connectionString.includes('sslmode'));
});
test('Supabase PostgreSQL schema and full backend support authentication, tickets, assignment, replies, knowledge and roles',async()=>{
  const {pg,db}=await fixture();let app;
  try{
    // Reapplying the migration preserves data and does not fail.
    await pg.exec(migration);await pg.exec('SET search_path=public,bizassist');
    app=await createApp(':memory:',true,{database:db});
    const port=await startServer(app.server,{port:0});const base=`http://127.0.0.1:${port}/api`;
    async function req(path,method='GET',body,cookie){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
    async function login(role){const r=await req('/login','POST',{email:role+'@bizassist.demo',password:'BizAssist123!'});assert.equal(r.status,200);return r.cookie;}
    assert.equal((await req('/health')).data.database,'supabase');
    const admin=await login('admin'),staff=await login('staff'),customer=await login('customer');
    const outsider=await req('/register','POST',{name:'Outsider',email:'outsider@example.com',password:'strongpassword',role:'admin'});
    assert.equal(outsider.data.user.role,'customer');
    const created=await req('/tickets','POST',{subject:'Billing question',body:'Please check the duplicate charge.'},customer);assert.equal(created.status,201);
    const path='/tickets/'+created.data.id;
    assert.equal((await req(path,'GET',null,outsider.cookie)).status,404);
    assert.equal((await req(path,'PATCH',{status:'Resolved'},customer)).status,403);
    assert.equal((await req(path,'PATCH',{status:'In Progress',assignee_id:2,priority:'High'},staff)).status,200);
    assert.equal((await req(path+'/messages','POST',{body:'We are investigating your invoice.'},staff)).status,201);
    assert.equal((await req(path+'/analyze','POST',{},staff)).status,200);
    await req(path,'PATCH',{status:'Resolved'},staff);
    await req(path+'/messages','POST',{body:'One more question.'},customer);
    const detail=(await req(path,'GET',null,customer)).data;
    assert.equal(detail.ticket.status,'Open');assert.equal(detail.ticket.assignee_id,2);assert.equal(detail.messages.length,2);assert.ok(detail.events.length>=4);assert.ok(!Number.isNaN(Date.parse(detail.ticket.created_at)));
    assert.equal((await req('/articles','POST',{title:'Cloud article',category:'General',content:'Stored in PostgreSQL.'},admin)).status,200);
    assert.ok((await req('/articles','GET',null,customer)).data.articles.some(a=>a.title==='Cloud article'));
    assert.equal((await req('/users','PATCH',{id:outsider.data.user.id,role:'staff'},admin)).status,200);
    assert.equal((await req('/me','GET',null,outsider.cookie)).data.user.role,'staff');
    await req('/logout','POST',{},customer);assert.equal((await req('/me','GET',null,customer)).status,401);
    const originalHealth=db.health;db.health=async()=>{throw Error('offline');};assert.equal((await req('/health','GET',null,admin)).status,503);db.health=originalHealth;
  }finally{if(app)await new Promise(r=>app.server.close(r));await db.close();}
});
test('Supabase API roles cannot read server-only data',async()=>{
  const {pg,db}=await fixture();
  try{
    for(const role of ['anon','authenticated']){
      await pg.exec(`SET ROLE ${role}`);
      await assert.rejects(pg.query('SELECT * FROM users'),/permission denied/);
      await pg.exec('RESET ROLE');
    }
    const r=await pg.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relrowsecurity AND c.relname IN ('users','sessions','tickets','messages','events','articles')");
    assert.equal(r.rows[0].n,6);
  }finally{await pg.exec('RESET ROLE');await db.close();}
});
test('SQLite import preserves account hashes and tickets, resets IDs and refuses nonempty destinations',async()=>{
  const source=await createApp(':memory:',true,{provider:'sqlite'});const {client,db}=await fixture();
  try{
    const count=await importSQLite(source.db,client);assert.equal(count,15);
    const user=await db.prepare('SELECT * FROM users WHERE id=?').get(3);
    assert.equal(user.password,source.db.prepare('SELECT password FROM users WHERE id=3').get().password);
    assert.equal((await db.prepare('SELECT * FROM tickets').all()).length,6);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions').get()).n,0);
    const added=await db.prepare('INSERT INTO articles(title,category,content) VALUES(?,?,?)').run('New','General','After import');assert.equal(added.lastInsertRowid,7);
    await assert.rejects(importSQLite(source.db,client),/empty target/);
    assert.equal((await db.prepare('SELECT * FROM tickets').all()).length,6);
  }finally{source.db.close();await db.close();}
});
