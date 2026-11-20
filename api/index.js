import { createApp } from '../server.js';

let appInstancePromise;

async function getApp() {
  if (!appInstancePromise) {
    appInstancePromise = createApp(
      process.env.DATABASE_PATH,
      process.env.DEMO_MODE === 'true',
      { provider: process.env.DATABASE_PROVIDER || 'supabase' }
    ).catch(err => {
      appInstancePromise = null;
      throw err;
    });
  }
  return appInstancePromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app.handler(req, res);
  } catch (err) {
    console.error('Serverless function startup error:', err?.message || err);
    if (!res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err?.message || 'Database connection error. Verify SUPABASE_DB_URL in your Vercel Environment Variables.'
      }));
    } else {
      res.end();
    }
  }
}
