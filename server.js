import http from 'node:http';
import {openDatabase,databaseMode} from './database.js';
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze, chat, fallback} from './ai.js';
import {inspectSupabaseConnection} from './supabase-client.js';

const root = dirname(fileURLToPath(import.meta.url));
export function passwordHash(password) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
function verify(password, hash) { const [salt,key]=hash.split(':'); return timingSafeEqual(Buffer.from(key,'hex'),scryptSync(password,salt,64)); }
const digest = token => createHash('sha256').update(token).digest('hex');
export async function createApp(dbPath = process.env.DATABASE_PATH || resolve(root,'data/bizassist.db'), demo = process.env.DEMO_MODE === 'true' || (databaseMode()==='sqlite' && process.env.DEMO_MODE !== 'false'), options={}) {
  const db=options.database||await openDatabase(dbPath,options);
  try {
  if(db.provider==='sqlite')await db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','staff','admin')));
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
  CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,subject TEXT NOT NULL,body TEXT NOT NULL,customer_id INTEGER REFERENCES users(id),assignee_id INTEGER REFERENCES users(id),status TEXT DEFAULT 'Open',priority TEXT,category TEXT,summary TEXT,suggestion TEXT,ai_source TEXT,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,ticket_id INTEGER REFERENCES tickets(id),user_id INTEGER REFERENCES users(id),body TEXT,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,ticket_id INTEGER REFERENCES tickets(id),actor TEXT,description TEXT,created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
  CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY,title TEXT,category TEXT,content TEXT);
  `);
  const addUser=async(name,email,password,role)=>(await db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,passwordHash(password),role));
  if (!(await db.prepare('SELECT id FROM articles LIMIT 1').get())) {
    const insert=db.prepare('INSERT INTO articles(title,category,content) VALUES(?,?,?)');
    await insert.run('Resetting your password','Account','If you cannot sign in, open a ticket with your registered email. Our support team will verify ownership and help restore access. Never share your password with anyone.');
    await insert.run('Understanding your invoices','Billing','Your invoice lists your subscription period, plan and applicable taxes. For a duplicate charge or invoice correction, submit a Billing ticket with the invoice number and date. Do not include full card details.');
    await insert.run('Reporting a technical issue','Technical','Include the affected page, the steps to reproduce the issue, your browser and the exact error message. For an outage affecting all users, explain the impact so our team can prioritise it.');
    await insert.run('How ticket tracking works','Getting started','Open My tickets to view your requests. Open means received, In Progress means the team is working on it, Waiting means we need more information, Resolved means a solution was provided, and Closed means the request is complete. Reply on a resolved or closed ticket to reopen it.');
    await insert.run('Requesting a refund','Billing','Submit a Billing ticket with your invoice number, purchase date and reason for the refund. A support specialist will review your request against your subscription terms. Approval is not automatic.');
    await insert.run('Keeping your account secure','Account','Use a unique password of at least 10 characters. Do not send passwords, authentication codes or payment details through support messages. Report suspected unauthorised access immediately.');
  }
  const articles=async()=>(await db.prepare('SELECT * FROM articles ORDER BY id').all());
  if(demo && !(await db.prepare('SELECT id FROM users LIMIT 1').get())) {
    await addUser('Alex Morgan','admin@bizassist.demo','BizAssist123!','admin');
    const staffId=(await addUser('Jamie Chen','staff@bizassist.demo','BizAssist123!','staff')).lastInsertRowid;
    const customerId=(await addUser('Taylor Wilson','customer@bizassist.demo','BizAssist123!','customer')).lastInsertRowid;
    for(const [subject,body,status] of [['Duplicate charge on my invoice','I noticed two payments for my November subscription. Could you check invoice BA-2048?','Open'],['Unable to access my account','I cannot login after changing my password. Please help me restore access.','In Progress'],['Dashboard reports are loading slowly','Reports take a long time to load in Chrome. The issue started this morning.','Waiting'],['Thanks for helping with our setup','Our workspace is now working perfectly. Thank you for the help!','Resolved'],['Export fails with an error','The export button shows an error and I am blocked from downloading my report.','Open'],['Question about our subscription','Where can I find the billing details for our team plan?','Closed']]) {
      const ai=fallback({subject,body},await articles());
      (await db.prepare('INSERT INTO tickets(subject,body,customer_id,assignee_id,status,priority,category,summary,suggestion,ai_source) VALUES(?,?,?,?,?,?,?,?,?,?)').run(subject,body,customerId,staffId,status,ai.priority,ai.category,ai.summary,ai.suggestedResponse,ai.source));
    }
  }
  const rates=new Map();
  const limited=(key,max=30)=>{const now=Date.now(); if(rates.size>10000) for(const [k,v] of rates) if(v.until<now) rates.delete(k); const entry=rates.get(key); if(!entry || entry.until<now){rates.set(key,{count:1,until:now+60000});return false;} return ++entry.count>max;};
  const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
  const ticketQuery=`SELECT t.*,c.name customer_name,c.email customer_email,a.name assignee_name FROM tickets t JOIN users c ON c.id=t.customer_id LEFT JOIN users a ON a.id=t.assignee_id`;
  const event=async(id,user,description)=>(await db.prepare('INSERT INTO events(ticket_id,actor,description) VALUES(?,?,?)').run(id,user.name,description));
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname; const method=req.method;
      if(path==='/api/health' && method==='GET'){try{await db.health();return send(200,{status:'ok',database:db.provider});}catch{return send(503,{status:'unavailable',database:db.provider});}}
      if(!path.startsWith('/api/')) { const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}; if(!files[path]) return send(404,{error:'Page not found'});res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css'}[extname(files[path])]);return res.end(readFileSync(resolve(root,'public',files[path]))); }
      if(!['GET','HEAD'].includes(method)) {
        if(req.headers.origin) {
          let origin;try{origin=new URL(req.headers.origin);}catch{return send(403,{error:'Origin rejected'});}
          if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)return send(403,{error:'Origin rejected'});
        }
        if(req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415,{error:'JSON content type required'});
      }
      let body={}; if(!['GET','HEAD'].includes(method)) {let raw=''; for await (const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>64000)return send(413,{error:'Request too large'});}try{body=JSON.parse(raw||'{}');if(!body || typeof body !== 'object' || Array.isArray(body))throw Error();}catch{return send(400,{error:'Invalid JSON'});} }
      const validText=(v,max=10000)=>typeof v==='string' && v.trim().length>0 && v.length<=max;
      const validId=v=>typeof v==='number' && Number.isSafeInteger(v) && v>0;
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
      const user=token ? (await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(digest(token),Date.now())) : null;
      if(path==='/api/login' || path==='/api/register') {
        if(method!=='POST')return send(405,{error:'Method not allowed'});
        if(limited(`auth:${req.socket.remoteAddress}`,20))return send(429,{error:'Too many attempts. Try again in a minute.'});
        if(!validText(body.email,254)||!validText(body.password,128))return send(400,{error:'Email and password required'});
        const email=body.email.trim().toLowerCase(); let account;
        if(path==='/api/register') {
          if(!validText(body.name,80)||!/^\S+@\S+\.\S+$/.test(email)||body.password.length<10)return send(400,{error:'Enter a name, valid email and password of at least 10 characters.'});
          if((await db.prepare('SELECT id FROM users WHERE email=?').get(email)))return send(409,{error:'This email is already registered.'});
          await addUser(body.name.trim(),email,body.password,'customer');
        }
        account=(await db.prepare('SELECT * FROM users WHERE email=?').get(email));
        if(!account || !verify(body.password,account.password))return send(401,{error:'Incorrect email or password'});
        const session=randomBytes(32).toString('hex'); (await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now())); (await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(session),account.id,Date.now()+86400000));
        res.setHeader('Set-Cookie',`session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return send(200,{user:publicUser(account)});
      }
      if(path==='/api/config' && method==='GET')return send(200,{demo,database:db.provider,provider:process.env.AI_PROVIDER==='openai-compatible' && process.env.AI_API_KEY ? 'AI provider with offline fallback':'Offline assistant'});
      if(!user)return send(401,{error:'Please sign in'});
      if(path==='/api/me' && method==='GET')return send(200,{user:publicUser(user)});
      if(path==='/api/integrations/supabase' && method==='GET'){
        if(user.role!=='admin')return send(403,{error:'Administrator access required'});
        if(limited(`supabase-check:${user.id}`,6))return send(429,{error:'Please wait a minute before checking again.'});
        try{return send(200,{...(await inspectSupabaseConnection()),activeDatabase:db.provider});}
        catch{return send(200,{configured:false,apiConnected:false,authReachable:false,activeDatabase:db.provider,message:'Configure the project URL and publishable key in .env.local.'});}
      }
      if(path==='/api/logout' && method==='POST'){(await db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token)));res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send(200,{ok:true});}
      if(path==='/api/users') {
        if(user.role!=='admin' && !(method==='GET' && user.role==='staff'))return send(403,{error:'Administrator access required'});
        if(method==='GET')return send(200,{users:(await db.prepare('SELECT id,name,email,role FROM users ORDER BY name').all())});
        if(method==='PATCH') {
          if(!validId(body.id))return send(400,{error:'A valid user ID is required'});
          if(!['customer','staff','admin'].includes(body.role))return send(400,{error:'Invalid role'});
          if(Number(body.id)===user.id)return send(400,{error:'You cannot change your own role'});
          if(!(await db.prepare('SELECT id FROM users WHERE id=?').get(Number(body.id))))return send(404,{error:'User not found'});
          if((await db.prepare("SELECT id FROM tickets WHERE assignee_id=? AND status NOT IN ('Closed','Resolved')").get(Number(body.id))) && body.role==='customer')return send(409,{error:'Reassign active tickets before changing this user to a customer'});
          (await db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role,Number(body.id)));return send(200,{ok:true});
        }
      }
      if(path==='/api/articles') {
        if(method==='GET')return send(200,{articles:await articles()});
        if(user.role!=='admin')return send(403,{error:'Administrator access required'});
        if(method==='PATCH' || method==='DELETE') {
          if(!validId(body.id))return send(400,{error:'A valid article ID is required'});
          if(!(await db.prepare('SELECT id FROM articles WHERE id=?').get(body.id)))return send(404,{error:'Article not found'});
        }
        if(method==='POST' || method==='PATCH') {if(!validText(body.title,150)||!validText(body.content,10000)||!validText(body.category,50))return send(400,{error:'Title, category and content required'});if(method==='POST')(await db.prepare('INSERT INTO articles(title,category,content) VALUES(?,?,?)').run(body.title,body.category,body.content));else (await db.prepare('UPDATE articles SET title=?,category=?,content=? WHERE id=?').run(body.title,body.category,body.content,Number(body.id)));return send(200,{ok:true});}
        if(method==='DELETE'){(await db.prepare('DELETE FROM articles WHERE id=?').run(Number(body.id)));return send(200,{ok:true});}
      }
      if(path==='/api/chat' && method==='POST'){if(!validText(body.question,2000))return send(400,{error:'Enter a question up to 2,000 characters'});if(limited(`ai:${user.id}`,15))return send(429,{error:'Please wait a minute before asking again'});return send(200,await chat(body.question,await articles()));}
      if(path==='/api/tickets') {
        if(method==='GET') {const rows=(await db.prepare(ticketQuery+(user.role==='customer'?' WHERE t.customer_id=?':'')+' ORDER BY t.updated_at DESC,t.id DESC').all(...(user.role==='customer'?[user.id]:[])));return send(200,{tickets:rows});}
        if(method==='POST') {if(!validText(body.subject,160)||!validText(body.body,10000))return send(400,{error:'Subject and description are required (160 / 10,000 characters maximum)'});if(limited(`ai:${user.id}`,15))return send(429,{error:'Please wait a minute before creating another ticket'});const ai=await analyze(body,await articles());const result=(await db.prepare('INSERT INTO tickets(subject,body,customer_id,priority,category,summary,suggestion,ai_source) VALUES(?,?,?,?,?,?,?,?)').run(body.subject.trim(),body.body.trim(),user.id,ai.priority,ai.category,ai.summary,ai.suggestedResponse,ai.source));await event(result.lastInsertRowid,user,'Created the ticket');return send(201,{id:Number(result.lastInsertRowid)});}
      }
      const match=path.match(/^\/api\/tickets\/(\d+)(?:\/(messages|analyze))?$/);
      if(match) {
        const id=Number(match[1]); const ticket=(await db.prepare(ticketQuery+' WHERE t.id=?').get(id));
        if(!ticket || (user.role==='customer' && ticket.customer_id!==user.id))return send(404,{error:'Ticket not found'});
        if(method==='GET' && !match[2])return send(200,{ticket,messages:(await db.prepare('SELECT m.*,u.name,u.role FROM messages m JOIN users u ON u.id=m.user_id WHERE ticket_id=? ORDER BY m.id').all(id)),events:(await db.prepare('SELECT * FROM events WHERE ticket_id=? ORDER BY id').all(id))});
        if(method==='POST' && match[2]==='messages') {if(!validText(body.body))return send(400,{error:'Write a reply (maximum 10,000 characters)'});(await db.prepare('INSERT INTO messages(ticket_id,user_id,body) VALUES(?,?,?)').run(id,user.id,body.body.trim()));if(user.role==='customer' && ['Resolved','Closed'].includes(ticket.status)){(await db.prepare("UPDATE tickets SET status='Open' WHERE id=?").run(id));await event(id,user,'Reopened the ticket');}(await db.prepare("UPDATE tickets SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id));return send(201,{ok:true});}
        if(user.role==='customer')return send(403,{error:'Support team access required'});
        if(method==='POST' && match[2]==='analyze'){if(limited(`ai:${user.id}`,15))return send(429,{error:'Please wait a minute'});const history=(await db.prepare('SELECT body FROM messages WHERE ticket_id=? ORDER BY id DESC LIMIT 10').all(id)).reverse().map(m=>m.body).join('\n');const ai=await analyze({...ticket,body:ticket.body+'\n'+history},await articles());(await db.prepare('UPDATE tickets SET summary=?,suggestion=?,ai_source=? WHERE id=?').run(ai.summary,ai.suggestedResponse,ai.source,id));return send(200,{ok:true});}
        if(method==='PATCH' && !match[2]) {
          if(body.assignee_id!==undefined && body.assignee_id!==null && !validId(body.assignee_id))return send(400,{error:'A valid assignee ID is required'});
          const status=body.status??ticket.status,priority=body.priority??ticket.priority,assignee=body.assignee_id===null?null:body.assignee_id??ticket.assignee_id;
          if(!['Open','In Progress','Waiting','Resolved','Closed'].includes(status)||!['Low','Normal','High','Urgent'].includes(priority))return send(400,{error:'Invalid status or priority'});
          const transitions={'Open':['In Progress','Waiting','Resolved'],'In Progress':['Open','Waiting','Resolved'],'Waiting':['Open','In Progress','Resolved'],'Resolved':['Open','Closed'],'Closed':['Open']};
          if(status!==ticket.status && !transitions[ticket.status].includes(status))return send(400,{error:`Cannot move directly from ${ticket.status} to ${status}`});
          if(assignee!==null && !(await db.prepare("SELECT id FROM users WHERE id=? AND role IN ('staff','admin')").get(Number(assignee))))return send(400,{error:'Assign to a staff member or administrator'});
          (await db.prepare("UPDATE tickets SET status=?,priority=?,assignee_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(status,priority,assignee,id));
          await event(id,user,`Updated status to ${status}, priority to ${priority}, assignee to ${assignee===null?'Unassigned':(await db.prepare('SELECT name FROM users WHERE id=?').get(Number(assignee))).name}`);return send(200,{ok:true});
        }
      }
      return send(404,{error:'Endpoint not found'});
    } catch(err) {
      const unavailable=db.provider==='supabase' && ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','08006','08001','57P01','53300'].includes(err.code);
      console.error('Request failed:',err.code||'internal error');
      if(!res.headersSent)send(err.code==='23505'?409:unavailable?503:500,{error:err.code==='23505'?'A record with these details already exists.':unavailable?'The database is temporarily unavailable. Please try again.':'Something went wrong. Please try again.'});else res.end();
    }
  });
  return {server,db};
  } catch(error) {await db.close();throw error;}
}
export async function startServer(server, {port=3000,host='127.0.0.1',fallback=true}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT must be an integer between 0 and 65535');
  for(let attempt=0;attempt<11;attempt++){
    try{
      await new Promise((resolve,reject)=>{const fail=error=>{server.off('listening',ready);reject(error);};const ready=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(port,host);});
      return server.address().port;
    }catch(error){if(error.code!=='EADDRINUSE'||!fallback||attempt===10||port===65535)throw error;port++;}
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let app;const host=process.env.HOST||'127.0.0.1';
  try{app=await createApp();const port=await startServer(app.server,{host,port:process.env.PORT?Number(process.env.PORT):3000,fallback:!process.env.PORT});console.log(`BizAssist AI running at http://${host}:${port} (${app.db.provider})`);}
  catch(error){console.error(error.code==='EADDRINUSE'?'The configured port is busy. Set a different PORT in .env and restart.':`Unable to start BizAssist: ${error.message}`);await app?.db.close();process.exitCode=1;}
}
