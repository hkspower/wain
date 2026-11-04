// accounts.mjs — the account model as DATA, with no dependency on the PHP, the
// SQL parser or a database. Both make-grants.mjs (which derives the grants) and
// render-grants.mjs (which fills in grants.sql on the machine that applies it)
// import it, so the rendering job needs only three files: this one,
// render-grants.mjs and grants.sql.

// Tables whose UPDATE stays table-wide although the code names columns. Each
// line says why, because a column list is only worth having when it is true on
// every install.
export const TABLE_WIDE_UPDATE = {
  customer_accounts: 'the birthday columns come from sporta-live/birthday/birthday.mysql.sql, not from install.mysql.sql; a column grant naming them fails on an install that lacks them',
}

// The accounts. `from` lists the code roles whose needs are unioned (so the
// single-account setup `web` is exactly shop + admin + cron, by construction).
// maxConn: a per-account connection cap, so a flood on the storefront cannot
// starve the payment callbacks. Their sum stays under MariaDB's default
// max_connections (151).
export const ACCOUNTS = {
  web: { user: 'sporta_web', host: 'app', maxConn: 100, from: ['shop', 'admin', 'cron'], tier: 1,
         what: 'ONE account for the whole web runtime and the host cron jobs (api, admin, customer, crm, assistant, SEO, birthday, cron-*). Needs no code change: it replaces db_user/db_pass.' },
  shop: { user: 'sporta_shop', host: 'app', maxConn: 80, from: ['shop'], tier: 2,
          what: 'storefront only: catalogue, checkout, order status, customer accounts, returns, support, assistant, SEO pages. Cannot read admin sign-in tables or change prices.' },
  admin: { user: 'sporta_admin', host: 'app', maxConn: 20, from: ['admin'], tier: 2,
           what: '/backends API, Google sign-in callback, preflight.' },
  cron: { user: 'sporta_cron', host: 'app', maxConn: 10, from: ['cron'], tier: 2,
          what: 'host cron: cron-stock, cron-fulfilment, cron-whatsapp, cron-birthday, cron-voice.' },
  knet: { user: 'sporta_knet', host: 'app', maxConn: 15, from: ['knet'], tier: 1,
          what: 'KNET start and callback. May update only the bank-result columns of an order.' },
  tpay: { user: 'sporta_tpay', host: 'app', maxConn: 15, from: ['tpay'], tier: 1,
          what: 'T-Pay start and callback. May update only the bank-result columns of an order.' },
  ro: { user: 'sporta_ro', host: 'job', maxConn: 3, special: 'readonly', tier: 1,
        what: 'read-only: backups (mariadb-dump --single-transaction), data scans, reports. A host/job credential: never put it in the web container.' },
  migrate: { user: 'sporta_migrate', host: 'job', maxConn: 3, special: 'migrate', tier: 1,
             what: 'schema owner for the *.mysql.sql migrations and setup-admin.php. A job credential used for seconds: never in the web container.' },
}

// What the migrations need beyond table DML (proved by the suite, which runs
// every migration as this account and removes each privilege to see it fail).
export const MIGRATE_DB_PRIVS = ['CREATE', 'ALTER', 'INDEX']
export const RO_DB_PRIVS = ['SELECT', 'SHOW VIEW']

