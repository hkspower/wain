// The hub's /admin pages: sign-in, first-run notice, and the dashboard.
//
// Server-rendered HTML with one inline script per page, run under a
// strict Content-Security-Policy that only admits a script carrying this
// response's nonce: no inline event handlers (every button is wired by
// delegation), no external code, nothing framed. The routing, the session
// and the role checks live in server/hub-server.mjs; this file only draws.
//
// One rule for the inline scripts: they sit inside JavaScript template
// literals here, so they use string concatenation, never ${...} or a
// backslash (both would be consumed by the template before the browser
// ever saw them).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BASE_CSS = `
  :root { color-scheme: dark; }
  body { background:#0a0d13; color:#e8eaf0; font:14px/1.4 -apple-system,system-ui,sans-serif; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:#8a8f9c; margin-bottom:20px; }
  .muted { color:#5c6270; }
  input, select, textarea, button { font:inherit; }
  input, select, textarea {
    background:#12161f; border:1px solid #232838; border-radius:6px; color:#e8eaf0; padding:7px 9px;
  }
  input:focus, select:focus, textarea:focus { outline:2px solid #f5a623; outline-offset:1px; }
  button.primary {
    background:#f5a623; border:none; border-radius:6px; color:#0a0d13; font-weight:600; padding:8px 14px; cursor:pointer;
  }
  button.primary:disabled { opacity:.5; cursor:default; }
  .err { color:#e5484d; font-size:13px; min-height:1.2em; }
  .ok { color:#46a758; font-size:13px; min-height:1.2em; }
`;

function shell({ title, nonce, body, script = "" }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<title>${esc(title)}</title>
<style>${BASE_CSS}</style></head>
<body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

/** The sign-in page. A plain form POST: it works with scripts off. */
export function loginPage({ nonce, error = "", username = "" }) {
  return shell({
    title: "Night Racer hub — sign in",
    nonce,
    body: `
<style>
  body { display:grid; place-items:center; min-height:calc(100vh - 48px); }
  .box { width:100%; max-width:340px; background:#12161f; border:1px solid #232838; border-radius:12px; padding:24px; }
  .box h1 { margin-bottom:2px; }
  .box .sub { margin-bottom:18px; }
  label { display:block; color:#8a8f9c; font-size:12px; text-transform:uppercase; letter-spacing:.05em; margin:12px 0 4px; }
  .box input { width:100%; box-sizing:border-box; }
  .box button { width:100%; margin-top:18px; }
</style>
<form class="box" method="post" action="/admin/login" autocomplete="on">
  <h1>Night Racer — hub</h1>
  <div class="sub">Operator sign-in</div>
  <div class="err" role="alert">${esc(error)}</div>
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="32" value="${esc(username)}" ${username ? "" : "autofocus"}>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required maxlength="256" ${username ? "autofocus" : ""}>
  <button class="primary" type="submit">Sign in</button>
</form>`,
  });
}

/** Shown while no operator account exists. There is no sign-up form on
 *  purpose: the first owner is made on the server itself. */
export function setupPage({ nonce, accountsPath }) {
  return shell({
    title: "Night Racer hub — set up",
    nonce,
    body: `
<style>
  .box { max-width:620px; background:#12161f; border:1px solid #232838; border-radius:12px; padding:24px; }
  code { background:#0a0d13; border:1px solid #232838; border-radius:6px; padding:2px 6px; }
  pre { background:#0a0d13; border:1px solid #232838; border-radius:8px; padding:12px; overflow:auto; }
</style>
<div class="box">
  <h1>Night Racer — hub</h1>
  <div class="sub">No operator accounts yet</div>
  <p>The admin panel is locked until the first owner account exists. Create it on the server, where only someone with shell access can:</p>
  <pre>npm run hub:admin -- add &lt;username&gt; --role owner</pre>
  <p class="muted">Accounts are kept in <code>${esc(accountsPath)}</code> (set <code>HUB_ADMINS</code> to move it). The hub picks the new account up within two seconds; reload this page to sign in.</p>
</div>`,
  });
}

/**
 * The dashboard, for a signed-in operator. What it shows depends on the
 * role; what it may DO is decided by the server on every request, so the
 * page hiding a button is a courtesy, never the control.
 */
export function dashboardPage({ nonce, username, role, csrf, perms, partCategories }) {
  const body = `
<style>
  .bar { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin-bottom:6px; }
  .who { color:#8a8f9c; }
  .who b { color:#e8eaf0; }
  .role { display:inline-block; border:1px solid #3a3020; color:#f5a623; border-radius:999px; padding:1px 8px; font-size:12px; margin-left:6px; }
  .barBtns { display:flex; gap:8px; }
  .ghost { background:none; border:1px solid #232838; color:#c5c9d3; border-radius:6px; padding:5px 10px; cursor:pointer; }
  .ghost:hover { color:#fff; border-color:#3a4256; }
  .cards { display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap; }
  .card { background:#12161f; border:1px solid #232838; border-radius:10px; padding:12px 16px; min-width:110px; }
  .card .n { font-size:24px; font-weight:600; color:#f5a623; }
  .card .l { color:#8a8f9c; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  .scroll { overflow-x:auto; margin-bottom:24px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:6px 10px; border-bottom:1px solid #1c2130; font-variant-numeric:tabular-nums; white-space:nowrap; }
  th { color:#8a8f9c; font-size:12px; text-transform:uppercase; letter-spacing:.05em; font-weight:500; }
  tr:last-child td { border-bottom:none; }
  .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; vertical-align:middle; }
  .tag { color:#f5a623; font-weight:600; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#8a8f9c; margin:0 0 8px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; align-items:flex-start; }
  .row textarea { width:240px; height:34px; resize:vertical; }
  .small { background:none; border:1px solid #232838; color:#8a8f9c; border-radius:6px; padding:3px 9px; font-size:12px; cursor:pointer; margin-left:6px; }
  .small:hover { color:#e8eaf0; }
  .danger { border-color:#3a2020; color:#e5484d; }
  .danger:hover { background:#1c1010; color:#ff6b6e; }
  .panel { border:1px solid #1c2130; border-radius:10px; padding:14px; margin-bottom:24px; }
  dialog { background:#12161f; color:#e8eaf0; border:1px solid #232838; border-radius:12px; padding:20px; max-width:360px; }
  dialog::backdrop { background:rgba(0,0,0,.6); }
  dialog input { width:100%; box-sizing:border-box; margin:4px 0 10px; }
  .ok-cell { color:#46a758; }
  .bad-cell { color:#e5484d; }
</style>
<div class="bar">
  <h1>Night Racer — hub</h1>
  <div class="barBtns">
    <span class="who">Signed in as <b>${esc(username)}</b><span class="role">${esc(role)}</span></span>
    <button class="ghost" data-act="open-password" type="button">Change password</button>
    <form method="post" action="/admin/logout" style="margin:0">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <button class="ghost" type="submit">Sign out</button>
    </form>
  </div>
</div>
<div class="sub" id="sub">connecting…</div>
<div class="cards" id="cards"></div>

<h2>Online (<span id="playerCount">0</span>)</h2>
<div class="scroll"><table id="players"><thead><tr><th></th><th>Name</th><th>Crew</th><th>Speed</th><th></th></tr></thead><tbody></tbody></table></div>
<h2>Leaderboard</h2>
<div class="scroll"><table id="leaderboard"><thead><tr><th>#</th><th>Name</th><th>Best lap</th></tr></thead><tbody></tbody></table></div>
<h2>Crews (<span id="teamCount">0</span>)</h2>
<div class="scroll"><table id="teams"><thead><tr><th>Tag</th><th>Name</th><th>Founder</th><th>Members</th></tr></thead><tbody></tbody></table></div>

${perms.partsWrite ? `
<!-- Queues a proposal; it never ships one: see the "part proposals" block
     in hub-server.mjs for what landing one into the game takes. -->
<h2>Propose a new part</h2>
<form class="row" id="partForm">
  <input name="id" placeholder="id — paint-navy" autocomplete="off" required style="width:140px">
  <select name="cat" required></select>
  <input name="name" placeholder="name — Navy Metallic" autocomplete="off" required style="width:170px">
  <input name="ar" placeholder="ar — كحلي معدني" autocomplete="off" required style="width:130px" dir="rtl">
  <input name="price" type="number" min="0" step="1" placeholder="price" autocomplete="off" required style="width:80px">
  <textarea name="desc" placeholder="desc (optional)"></textarea>
  <button class="primary" type="submit">Queue proposal</button>
  <div class="err" id="partErr" style="width:100%"></div>
</form>` : ""}
<h2>Pending proposals (<span id="proposalCount">0</span>)</h2>
<div class="scroll"><table id="proposals"><thead><tr><th>id</th><th>cat</th><th>name</th><th>ar</th><th>price</th><th>desc</th><th>submitted</th><th></th></tr></thead><tbody></tbody></table></div>

${perms.accounts ? `
<h2>Operator accounts</h2>
<div class="panel">
  <form class="row" id="acctForm" autocomplete="off">
    <input name="username" placeholder="username" required maxlength="32" autocapitalize="none" spellcheck="false" style="width:150px">
    <input name="password" type="password" placeholder="password (12+ characters)" required maxlength="256" autocomplete="new-password" style="width:220px">
    <select name="role">
      <option value="viewer">viewer — reads the dashboard</option>
      <option value="operator">operator — also manages proposals</option>
      <option value="owner">owner — also manages accounts</option>
    </select>
    <button class="primary" type="submit">Add account</button>
    <div class="err" id="acctErr" style="width:100%"></div>
  </form>
  <div class="scroll" style="margin:0"><table id="accounts"><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Created</th><th></th></tr></thead><tbody></tbody></table></div>
</div>` : ""}

${perms.audit ? `
<h2>Audit log</h2>
<div class="scroll"><table id="audit"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>Result</th><th>From</th></tr></thead><tbody></tbody></table></div>` : ""}

<dialog id="pwDialog">
  <form id="pwForm">
    <h2>Change your password</h2>
    <input name="current" type="password" placeholder="current password" required autocomplete="current-password" maxlength="256">
    <input name="next" type="password" placeholder="new password (12+ characters)" required autocomplete="new-password" maxlength="256">
    <input name="again" type="password" placeholder="new password again" required autocomplete="new-password" maxlength="256">
    <div class="err" id="pwErr"></div>
    <div class="row" style="justify-content:flex-end;margin:6px 0 0">
      <button class="ghost" type="button" data-act="close-password">Cancel</button>
      <button class="primary" type="submit">Change</button>
    </div>
  </form>
</dialog>`;

  const script = `
var ME = ${JSON.stringify({ username, role, csrf, perms })};
var PART_CATEGORIES = ${JSON.stringify(partCategories)};
var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
var fmtLap = function (ms) { var m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(1).padStart(4, "0"); return m + ":" + s; };
var $ = function (id) { return document.getElementById(id); };

// Every admin call goes through here: the session cookie rides along
// (same origin), writes carry the CSRF token, and a lapsed session sends
// the operator back to the sign-in page instead of failing silently.
function api(path, method, body) {
  var opts = { method: method || "GET", headers: {} };
  if (opts.method !== "GET") opts.headers["X-CSRF-Token"] = ME.csrf;
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  return fetch(path, opts).then(function (r) {
    if (r.status === 401) { location.href = "/admin"; throw new Error("signed out"); }
    return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; });
  });
}
var pub = function (u) { return fetch(u).then(function (r) { return r.json(); }); };

if ($("partForm")) {
  $("partForm").querySelector("select[name=cat]").innerHTML =
    PART_CATEGORIES.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join("");
}

function when(iso) { return iso ? new Date(iso).toLocaleString() : '<span class="muted">never</span>'; }

function tick() {
  return Promise.all([pub("/api/v1/status"), pub("/api/v1/players"), pub("/api/v1/leaderboard"), pub("/api/v1/teams"), api("/api/v1/admin/parts")])
    .then(function (all) {
      var status = all[0], players = all[1], board = all[2], teams = all[3], parts = all[4];
      $("sub").textContent = status.game + " — uptime " + Math.floor(status.uptimeSec / 60) + "m — refreshed " + new Date().toLocaleTimeString();
      $("cards").innerHTML =
        '<div class="card"><div class="n">' + status.online + '</div><div class="l">Online</div></div>' +
        '<div class="card"><div class="n">' + status.teams + '</div><div class="l">Crews</div></div>' +
        '<div class="card"><div class="n">' + board.entries.length + '</div><div class="l">Lap times</div></div>' +
        '<div class="card"><div class="n">' + parts.proposals.length + '</div><div class="l">Proposals</div></div>';
      $("playerCount").textContent = players.players.length;
      $("players").querySelector("tbody").innerHTML = players.players.map(function (p) {
        return '<tr><td><span class="dot" style="background:' + esc(p.color) + '"></span></td><td>' + esc(p.name) + '</td>' +
          '<td>' + (p.crew ? '<span class="tag">[' + esc(p.crew.tag) + ']</span> ' + esc(p.crew.name) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (p.speedKmh === null ? '<span class="muted">—</span>' : p.speedKmh + ' km/h') + '</td>' +
          '<td>' + (p.inDuel ? '<span class="tag">duel</span>' : '') + '</td></tr>';
      }).join("") || '<tr><td colspan="5" class="muted">nobody online</td></tr>';
      $("leaderboard").querySelector("tbody").innerHTML = board.entries.map(function (e, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(e.name) + '</td><td>' + fmtLap(e.ms) + '</td></tr>';
      }).join("") || '<tr><td colspan="3" class="muted">no laps yet</td></tr>';
      $("teamCount").textContent = teams.teams.length;
      $("teams").querySelector("tbody").innerHTML = teams.teams.map(function (t) {
        return '<tr><td class="tag">[' + esc(t.tag) + ']</td><td>' + esc(t.name) + '</td><td>' + esc(t.founder) + '</td>' +
          '<td>' + t.members.filter(function (m) { return m.online; }).length + ' / ' + t.members.length + '</td></tr>';
      }).join("") || '<tr><td colspan="4" class="muted">no crews founded yet</td></tr>';
      $("proposalCount").textContent = parts.proposals.length;
      $("proposals").querySelector("tbody").innerHTML = parts.proposals.map(function (p) {
        return '<tr><td>' + esc(p.id) + '</td><td>' + esc(p.cat) + '</td><td>' + esc(p.name) + '</td>' +
          '<td dir="rtl">' + esc(p.ar) + '</td><td>' + esc(p.price) + '</td><td class="muted">' + esc(p.desc || "—") + '</td>' +
          '<td class="muted">' + when(p.submittedAt) + '</td><td>' +
          '<button class="small" data-act="copy-part" data-part="' + esc(JSON.stringify(p)) + '">copy</button>' +
          (ME.perms.partsWrite ? '<button class="small danger" data-act="reject-part" data-id="' + esc(p.proposalId) + '">reject</button>' : '') +
          '</td></tr>';
      }).join("") || '<tr><td colspan="8" class="muted">nothing queued</td></tr>';
    })
    .then(function () { return ME.perms.accounts ? loadAccounts() : null; })
    .then(function () { return ME.perms.audit ? loadAudit() : null; })
    .catch(function (err) { $("sub").textContent = "could not reach the hub: " + err.message; });
}

function loadAccounts() {
  return api("/api/v1/admin/accounts").then(function (j) {
    $("accounts").querySelector("tbody").innerHTML = j.accounts.map(function (a) {
      var me = a.username === ME.username;
      var roles = ["viewer", "operator", "owner"].map(function (r) {
        return '<option value="' + r + '"' + (r === a.role ? " selected" : "") + '>' + r + '</option>';
      }).join("");
      return '<tr><td>' + esc(a.username) + (me ? ' <span class="muted">(you)</span>' : '') + '</td>' +
        '<td><select data-act="set-role" data-user="' + esc(a.username) + '">' + roles + '</select></td>' +
        '<td class="' + (a.disabled ? 'bad-cell">disabled' : 'ok-cell">active') + '</td>' +
        '<td class="muted">' + when(a.lastLoginAt) + '</td><td class="muted">' + when(a.createdAt) + ' by ' + esc(a.createdBy) + '</td><td>' +
        '<button class="small" data-act="reset-pw" data-user="' + esc(a.username) + '">reset password</button>' +
        '<button class="small" data-act="toggle" data-user="' + esc(a.username) + '" data-disabled="' + (a.disabled ? "1" : "") + '">' + (a.disabled ? "enable" : "disable") + '</button>' +
        (me ? '' : '<button class="small danger" data-act="delete" data-user="' + esc(a.username) + '">delete</button>') +
        '</td></tr>';
    }).join("");
  });
}

function loadAudit() {
  return api("/api/v1/admin/audit?limit=100").then(function (j) {
    $("audit").querySelector("tbody").innerHTML = j.entries.map(function (e) {
      return '<tr><td class="muted">' + new Date(e.at).toLocaleString() + '</td><td>' + esc(e.actor) + '</td><td>' + esc(e.action) +
        (e.detail ? ' <span class="muted">' + esc(e.detail) + '</span>' : '') + '</td><td>' + esc(e.target || "") + '</td>' +
        '<td class="' + (e.ok ? 'ok-cell">ok' : 'bad-cell">refused') + '</td><td class="muted">' + esc(e.ip || "") + '</td></tr>';
    }).join("") || '<tr><td colspan="6" class="muted">nothing yet</td></tr>';
  });
}

tick();
setInterval(tick, 4000);

function flash(el, msg) { el.textContent = msg; }

if ($("partForm")) $("partForm").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var f = ev.target, btn = f.querySelector("button"), box = $("partErr");
  box.textContent = "";
  btn.disabled = true;
  api("/api/v1/admin/parts", "POST", {
    id: f.id.value.trim(), cat: f.cat.value, name: f.name.value.trim(), ar: f.ar.value.trim(),
    price: Number(f.price.value), desc: f.desc.value.trim(),
  }).then(function () { f.reset(); return tick(); })
    .catch(function (err) { flash(box, err.message); })
    .then(function () { btn.disabled = false; });
});

if ($("acctForm")) $("acctForm").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var f = ev.target, box = $("acctErr");
  box.textContent = "";
  api("/api/v1/admin/accounts", "POST", { username: f.username.value.trim(), password: f.password.value, role: f.role.value })
    .then(function () { f.reset(); return tick(); })
    .catch(function (err) { flash(box, err.message); });
});

$("pwForm").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var f = ev.target, box = $("pwErr");
  box.textContent = "";
  if (f.next.value !== f.again.value) { flash(box, "the two new passwords do not match"); return; }
  api("/api/v1/admin/password", "POST", { current: f.current.value, next: f.next.value })
    .then(function () { f.reset(); $("pwDialog").close(); $("sub").textContent = "password changed — your other sessions were signed out"; })
    .catch(function (err) { flash(box, err.message); });
});

// One listener for every button and select on the page: the CSP admits
// no inline handlers.
document.addEventListener("click", function (ev) {
  var t = ev.target.closest("[data-act]");
  if (!t || t.tagName === "SELECT") return;
  var act = t.dataset.act, user = t.dataset.user;
  if (act === "open-password") $("pwDialog").showModal();
  else if (act === "close-password") $("pwDialog").close();
  else if (act === "copy-part") {
    var p = JSON.parse(t.dataset.part), q = JSON.stringify;
    var ts = "{ id: " + q(p.id) + ", cat: " + q(p.cat) + ", name: " + q(p.name) + ", ar: " + q(p.ar) + ", price: " + p.price + ", desc: " + q(p.desc) + " },";
    (navigator.clipboard ? navigator.clipboard.writeText(ts) : Promise.reject()).catch(function () {});
    var was = t.textContent; t.textContent = "copied"; setTimeout(function () { t.textContent = was; }, 1200);
  } else if (act === "reject-part") {
    t.disabled = true;
    api("/api/v1/admin/parts/" + encodeURIComponent(t.dataset.id), "DELETE").then(tick).catch(function (err) { alert(err.message); t.disabled = false; });
  } else if (act === "reset-pw") {
    var pw = prompt("New password for " + user + " (12+ characters). Their sessions will be signed out.");
    if (pw) api("/api/v1/admin/accounts/" + encodeURIComponent(user), "PATCH", { password: pw }).then(tick).catch(function (err) { alert(err.message); });
  } else if (act === "toggle") {
    api("/api/v1/admin/accounts/" + encodeURIComponent(user), "PATCH", { disabled: !t.dataset.disabled }).then(tick).catch(function (err) { alert(err.message); });
  } else if (act === "delete") {
    if (confirm("Delete the account " + user + "? This cannot be undone.")) {
      api("/api/v1/admin/accounts/" + encodeURIComponent(user), "DELETE").then(tick).catch(function (err) { alert(err.message); });
    }
  }
});
document.addEventListener("change", function (ev) {
  var t = ev.target;
  if (t.dataset && t.dataset.act === "set-role") {
    api("/api/v1/admin/accounts/" + encodeURIComponent(t.dataset.user), "PATCH", { role: t.value })
      .then(tick).catch(function (err) { alert(err.message); tick(); });
  }
});
`;
  return shell({ title: "Night Racer hub", nonce, body, script });
}
