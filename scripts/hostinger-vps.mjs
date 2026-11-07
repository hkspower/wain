#!/usr/bin/env node
// One call to the hostinger-vps connector, from a shell.
//
//   node scripts/hostinger-vps.mjs search  '{"query":"docker logs"}'
//   node scripts/hostinger-vps.mjs execute '{"operation":"vps_docker_list","params":{"virtualMachineId":2058651}}'
//   node scripts/hostinger-vps.mjs create-plan <compose.json>   # start a sporta vps-deploy.mjs job
//
// It exists because a session's MCP tools load when the session starts: a
// connector that could not connect then (no token yet) stays absent until the
// next session. This speaks the same stdio JSON-RPC to the same launcher, so a
// call from here and a call through the tool are the same request.
//
// Sporta's deploy jobs (GO-LIVE.md on its branch, "Deploying to the VPS") are
// what it is for: plan, scan and preflight mount the live site read-only, and
// apply refuses unless the full commit SHA is given twice — that guard lives
// in vps-deploy.mjs itself.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LAUNCHER = fileURLToPath(new URL("../mcp/hostinger-mcp.mjs", import.meta.url));
const VPS_ID = 2058651;

const [cmd, arg] = process.argv.slice(2);
let tool = cmd;
let args;
if (cmd === "create-plan") {
  // vps-deploy.mjs prints the compose JSON and then a human summary line;
  // only the JSON is the project.
  const text = readFileSync(arg, "utf8");
  const content = text.slice(0, text.lastIndexOf("}") + 1);
  JSON.parse(content);
  tool = "execute";
  args = {
    operation: "vps_docker_create",
    params: { virtualMachineId: VPS_ID, project_name: "sporta-deploy", content },
  };
} else if (cmd === "search" || cmd === "execute") {
  args = JSON.parse(arg ?? "{}");
} else {
  console.error("usage: hostinger-vps.mjs search|execute <json> | create-plan <compose.json>");
  process.exit(2);
}

const c = spawn("node", [LAUNCHER, "vps"], { stdio: ["pipe", "pipe", "ignore"] });
let buf = "";
c.stdout.on("data", (d) => {
  buf += d;
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== 2) continue;
    const r = m.result;
    console.log(r?.content?.[0]?.text ?? JSON.stringify(m));
    c.kill();
    process.exit(r?.isError || m.error ? 1 : 0);
  }
});
const send = (m) => c.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wain-cli", version: "1" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
setTimeout(() => { console.error("hostinger-vps: no answer in 120s"); c.kill(); process.exit(1); }, 120_000);
