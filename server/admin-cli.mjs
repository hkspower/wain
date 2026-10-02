// Operator accounts for the hub's /admin panel, from the command line.
//
//   npm run hub:admin -- add <username> --role owner      # the first owner
//   npm run hub:admin -- add <username> --role operator
//   npm run hub:admin -- passwd <username>                # reset a password
//   npm run hub:admin -- role <username> <owner|operator|viewer>
//   npm run hub:admin -- disable <username>  |  enable <username>
//   npm run hub:admin -- remove <username>
//   npm run hub:admin -- list
//
// The password is asked for twice, without echo. For scripts and
// containers, pipe it instead: `printf '%s' "$PW" | npm run hub:admin --
// add ops --role operator --password-stdin`.
//
// Same file the hub reads (HUB_ADMINS, default server/data/admins.json),
// and the hub picks changes up within two seconds, ending the sessions a
// change invalidates. There is deliberately no web sign-up: the first
// owner is made here, by whoever can run commands on the box, which is
// the only person who should be able to.
import { createAdminAuth, ROLES } from "./admin-auth.mjs";

const ACCOUNTS = process.env.HUB_ADMINS || "server/data/admins.json";
const AUDIT = process.env.HUB_ADMIN_AUDIT || "server/data/admin-audit.json";
const auth = createAdminAuth({ accountsPath: ACCOUNTS, auditPath: AUDIT });
const by = `cli:${process.env.USER || process.env.USERNAME || "local"}`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);
const [cmd, user, extra] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--role"));

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function readStdin() {
  let s = "";
  for await (const c of process.stdin) s += c;
  return s.replace(/\r?\n$/, "");
}

/** Ask without echo, twice, on a terminal. */
async function askPassword(prompt) {
  if (has("--password-stdin")) return readStdin();
  if (!process.stdin.isTTY) die("no terminal to ask for a password on: use --password-stdin");
  const ask = (q) =>
    new Promise((resolve) => {
      process.stdout.write(q);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      let pw = "";
      const on = (ch) => {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", on);
          process.stdout.write("\n");
          resolve(pw);
        } else if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === "\u007f" || ch === "\b") {
          pw = pw.slice(0, -1);
        } else {
          pw += ch;
        }
      };
      stdin.on("data", on);
    });
  const a = await ask(prompt);
  const b = await ask("again: ");
  if (a !== b) die("the two passwords do not match");
  return a;
}

const done = (r) => {
  auth.flush();
  if (r?.error) die(r.error);
};

switch (cmd) {
  case "add": {
    if (!user) die("usage: add <username> --role <owner|operator|viewer>");
    const role = flag("--role") ?? (auth.hasAccounts() ? "viewer" : "owner");
    if (!ROLES.includes(role)) die(`role must be one of ${ROLES.join(", ")}`);
    const pw = await askPassword(`password for ${user}: `);
    const r = await auth.createAccount({ username: user, password: pw, role, by });
    done(r);
    console.log(`added ${r.account.username} (${r.account.role}) to ${ACCOUNTS}`);
    break;
  }
  case "passwd": {
    if (!user) die("usage: passwd <username>");
    const pw = await askPassword(`new password for ${user}: `);
    const r = await auth.updateAccount(user, { password: pw }, { by });
    done(r);
    console.log(`password changed for ${r.account.username}; their sessions are ended`);
    break;
  }
  case "role": {
    if (!user || !extra) die("usage: role <username> <owner|operator|viewer>");
    const r = await auth.updateAccount(user, { role: extra }, { by });
    done(r);
    console.log(`${r.account.username} is now ${r.account.role}`);
    break;
  }
  case "disable":
  case "enable": {
    if (!user) die(`usage: ${cmd} <username>`);
    const r = await auth.updateAccount(user, { disabled: cmd === "disable" }, { by });
    done(r);
    console.log(`${r.account.username} ${cmd}d`);
    break;
  }
  case "remove": {
    if (!user) die("usage: remove <username>");
    const r = auth.deleteAccount(user, { by });
    done(r);
    console.log(`removed ${user}`);
    break;
  }
  case "list": {
    const rows = auth.listAccounts();
    if (!rows.length) console.log(`no accounts in ${ACCOUNTS} — add the first owner: npm run hub:admin -- add <name> --role owner`);
    for (const a of rows) {
      console.log(`${a.username.padEnd(24)} ${a.role.padEnd(9)} ${a.disabled ? "disabled " : "         "} last sign-in ${a.lastLoginAt ?? "never"}`);
    }
    break;
  }
  default:
    console.log("usage: npm run hub:admin -- <add|passwd|role|disable|enable|remove|list> ...  (see the top of server/admin-cli.mjs)");
    process.exit(cmd ? 1 : 0);
}
