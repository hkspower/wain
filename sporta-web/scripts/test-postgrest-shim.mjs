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

async function asRole(role, sql) {
  const { stdout } = await run('psql', [...PSQL, '-v', 'ON_ERROR_STOP=1', '-c', `set role ${role}; ${sql}`])
  return stdout.trim()
}
const asAnon = (sql) => asRole('anon', sql)

// Which Postgres role a request runs as, decided the way Supabase decides it:
// from the `role` claim in the bearer JWT. The admin policies are granted `to
// authenticated`, so a shim that ran everything as `anon` would show the admin
// an empty dashboard and prove nothing about whether those policies work.
const roleOf = (req) => {
  const auth = req.headers.authorization || ''
  const tok = auth.replace(/^Bearer\s+/i, '')
  try {
    const b64 = (tok.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString())
    return claims.role === 'authenticated' ? 'authenticated' : 'anon'
  } catch { return 'anon' }
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

    // ---- Supabase Auth stand-in --------------------------------------------
    // supabase-js does not verify the signature client-side; it reads the claims
    // for the role and the expiry. So a well-formed unsigned JWT is enough to
    // drive a real admin session, which is what makes the admin screens
    // testable at all.
    const jwt = (role, email) => {
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
        role, email, sub: '00000000-0000-4000-8000-000000000001',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.shim`
    }
    const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@sporta.com.kw',
                   aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }

    if (u.pathname === '/auth/v1/token') {
      // Only this one pair signs in, so a wrong-password path exists to test.
      if (body.email !== 'admin@sporta.com.kw' || body.password !== 'correct-horse') {
        return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials',
                                message: 'Invalid login credentials' })
      }
      return json(res, 200, {
        access_token: jwt('authenticated', body.email), token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'shim-refresh', user: USER,
      })
    }
    if (u.pathname === '/auth/v1/user') {
      return roleOf(req) === 'authenticated' ? json(res, 200, USER)
                                            : json(res, 401, { message: 'invalid claim' })
    }
    if (u.pathname === '/auth/v1/logout') return json(res, 204)

    // ---- admin reads -------------------------------------------------------
    const role = roleOf(req)
    const table = u.pathname.startsWith('/rest/v1/') && !u.pathname.includes('/rpc/')
      ? u.pathname.slice('/rest/v1/'.length) : null

    if (u.pathname === '/rest/v1/rpc/admin_order_stats' || u.pathname === '/rest/v1/rpc/admin_revenue_daily') {
      const fn = u.pathname.endsWith('admin_order_stats')
        ? 'public.admin_order_stats()'
        : `public.admin_revenue_daily(${Number(body.p_days ?? body.days ?? 14)})`
      try {
        const out = await asRole(role, `select coalesce(json_agg(t),'[]') from (select * from ${fn}) t`)
        return json(res, 200, JSON.parse(out))
      } catch (e) {
        const m = String(e.stderr || e.message).match(/ERROR:\s*([^\n]+)/)
        return json(res, 403, { message: m ? m[1].trim() : 'error', code: '42501' })
      }
    }

    if (table === 'orders' || table === 'order_items') {
      if (req.method === 'PATCH') {
        const sets = Object.entries(body).map(([k, v]) => `${k} = ${v === null ? 'null' : lit(v)}`).join(', ')
        const idEq = (u.searchParams.get('id') || '').replace(/^eq\./, '')
        try {
          const out = await asRole(role,
            `with u as (update public.${table} set ${sets} where id = ${lit(idEq)} returning *)
             select coalesce(json_agg(u),'[]') from u`)
          return json(res, 200, JSON.parse(out))
        } catch (e) {
          const m = String(e.stderr || e.message).match(/ERROR:\s*([^\n]+)/)
          return json(res, 400, { message: m ? m[1].trim() : 'error' })
        }
      }
      const out = await asRole(role,
        `select coalesce(json_agg(t),'[]') from (select * from public.${table} order by created_at desc limit 200) t`)
      const rows = JSON.parse(out)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(rows.length-1,0)}/${rows.length}`,
        'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'content-range' })
      return res.end(out)
    }

    if (u.pathname === '/rest/v1/rpc/set_device_passcode') {
      try {
        const out = await asRole(role, `select public.set_device_passcode(${lit(body.p_device_id)}, ${lit(body.p_passcode)}, ${lit(body.p_label)})`)
        return json(res, 200, out === '' ? null : out)
      } catch (e) {
        const m = String(e.stderr || e.message).match(/ERROR:\s*([^\n]+)/)
        return json(res, 400, { message: m ? m[1].trim() : 'error' })
      }
    }
    if (u.pathname === '/rest/v1/rpc/verify_device_passcode') {
      try {
        // Returns jsonb, not a row set — wrapping it in row_to_json() failed
        // with "function row_to_json(jsonb) does not exist", which the lock
        // screen surfaced to the user as "Could not verify. Check your
        // connection." A connection problem was never what it was.
        const out = await asRole(role, `select public.verify_device_passcode(${lit(body.p_device_id)}, ${lit(body.p_passcode)})`)
        return json(res, 200, JSON.parse(out))
      } catch (e) {
        const m = String(e.stderr || e.message).match(/ERROR:\s*([^\n]+)/)
        return json(res, 400, { message: m ? m[1].trim() : 'error' })
      }
    }

    if (u.pathname === '/rest/v1/rpc/create_order') {
      const sql = `select public.create_order(${lit(body.p_track_id)}, ${lit(
        JSON.stringify(body.p_items),
      )}::jsonb, ${lit(JSON.stringify(body.p_customer))}::jsonb, ${lit(body.p_payment_method ?? 'knet')})`
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

    // go-live.html probes these.
    if (u.pathname === '/rest/v1/products') {
      // Honour ?select= instead of always returning just the slug. Hard-coding
      // `select slug` made the admin Catalogue compare every price against
      // `undefined`, so all 20 products read as "price differs from the site" —
      // a scary, entirely fictional finding produced by the test rig.
      // "*" is what supabase-js sends for .select('*'), and the sanitiser
      // rejected it as not-a-column-name, silently falling back to slug alone.
      // The admin Products table then rendered 46 rows of blank names and
      // "NaN KWD" — a convincing-looking bug that was entirely this shim's.
      const raw = u.searchParams.get('select') || '*'
      const cols = raw.trim() === '*'
        ? '*'
        : raw.split(',').map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c)).join(', ') || 'slug'
      const out = await asAnon(`select coalesce(json_agg(t),'[]') from (select ${cols} from public.products) t`)
      const n = JSON.parse(out).length
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': `0-${n - 1}/${n}`,
        'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'content-range' })
      return res.end(out)
    }
    if (u.pathname === '/rest/v1/rpc/has_device_passcode') {
      try {
        const out = await asRole(role, `select public.has_device_passcode(${lit(body.p_device_id)})`)
        return json(res, 200, out === 't')
      } catch { return json(res, 401, { message: 'permission denied' }) }
    }

    if (u.pathname === '/rest/v1/rpc/get_order_status') {
      const out = await asAnon(
        `select coalesce(json_agg(t),'[]') from (select * from public.get_order_status(${lit(body.p_track_id)})) t`,
      )
      return json(res, 200, JSON.parse(out))
    }

    // A catch-all 200 [] is how a test rig starts lying. set_device_passcode was
    // unimplemented and fell through to here, so supabase-js saw a successful
    // empty response, the UI called markEnrolled() and reported the device
    // enrolled — while the passcode table stayed empty. An unimplemented route
    // has to look like a failure, and say which route it was.
    console.log(`  !! UNIMPLEMENTED ${req.method} ${u.pathname}`)
    json(res, 404, { message: `shim does not implement ${u.pathname}`, code: 'PGRST202' })
  })
}).listen(8130, '127.0.0.1', () => console.log('postgrest shim -> real postgres on 8130'))
