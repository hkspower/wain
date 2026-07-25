// A thin PostgREST stand-in that executes against the REAL PostgreSQL running
// on :5433, as the REAL `anon` role. Requests go browser -> supabase-js ->
// here -> psql, so RLS, the SECURITY DEFINER boundary and every validation in
// create_order are genuinely exercised. A hand-written mock would have proved
// nothing about the thing that was actually broken.
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'sporta', '-tAq']

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

async function asAnon(sql) {
  const { stdout } = await run('psql', [...PSQL, '-v', 'ON_ERROR_STOP=1', '-c', `set role anon; ${sql}`])
  return stdout.trim()
}

const json = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    if (req.method === 'OPTIONS') return json(res, 204)
    const body = raw ? JSON.parse(raw) : {}

    if (u.pathname === '/rest/v1/rpc/create_order') {
      const sql = `select public.create_order(${lit(body.p_track_id)}, ${lit(
        JSON.stringify(body.p_items),
      )}::jsonb, ${lit(JSON.stringify(body.p_customer))}::jsonb)`
      try {
        const out = await asAnon(sql)
        console.log('  create_order OK ->', out)
        return json(res, 200, JSON.parse(out))
      } catch (e) {
        // Surface the raised token the way PostgREST does.
        const m = String(e.stderr || e.message).match(/ERROR:\s*([^\n]+)/)
        const message = m ? m[1].trim() : 'error'
        console.log('  create_order REJECTED ->', message)
        return json(res, 400, { message, code: 'P0001' })
      }
    }

    if (u.pathname === '/rest/v1/rpc/get_order_status') {
      const out = await asAnon(
        `select coalesce(json_agg(t),'[]') from (select * from public.get_order_status(${lit(body.p_track_id)})) t`,
      )
      return json(res, 200, JSON.parse(out))
    }

    json(res, 200, [])
  })
}).listen(8130, '127.0.0.1', () => console.log('postgrest shim -> real postgres on 8130'))
