#!/usr/bin/env node
// `dotnet <args>`, with a message a person can act on when there is no
// dotnet. Behind npm run test:unity-cars and npm run check:unity-compile,
// which compile the Unity port's C# outside Unity (tools/unity/carcheck,
// tools/unity/typecheck).
//
//   node scripts/run-dotnet.mjs build tools/unity/typecheck -nologo -v q
//
// Without it a machine with no SDK prints "sh: dotnet: command not found"
// on a Mac and "'dotnet' is not recognized..." on Windows, neither of
// which says what to install. Everything else, exit code included, is
// dotnet's own.

import { spawnSync } from "node:child_process";

const r = spawnSync("dotnet", process.argv.slice(2), { stdio: "inherit" });
if (r.error && r.error.code === "ENOENT") {
  console.error(
    "dotnet is not installed (or not on PATH).\n" +
      "These checks compile the Unity port's C# with the .NET 8 SDK, no Unity needed:\n" +
      "  https://dotnet.microsoft.com/download/dotnet/8.0\n" +
      "(macOS has Arm64 and x64 installers there; open a new terminal after installing.)"
  );
  process.exit(127);
}
if (r.error) {
  console.error(`dotnet could not be started: ${r.error.message}`);
  process.exit(1);
}
// A signal (Ctrl-C) leaves status null; report it as a failure.
process.exit(r.status ?? 1);
