import { readablePipe, readStream, stripAnsi } from "./process";
import type { AuthChallenge } from "./types";

let authProcess: ReturnType<typeof Bun.spawn> | null = null;
let authChallenge: AuthChallenge | null = null;
let authOutput = "";

function parseAuthChallenge(output: string): AuthChallenge | null {
  const cleanOutput = stripAnsi(output);
  const uri = cleanOutput.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0];
  const code = cleanOutput.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5,8}\b/)?.[0];

  if (!uri || !code) {
    return null;
  }

  return {
    verificationUri: uri,
    userCode: code,
    expiresInMinutes: 15,
    startedAt: new Date().toISOString(),
  };
}

export async function codexLoginStatus() {
  const process = Bun.spawn(["bunx", "codex", "login", "status"], {
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  const output = `${stdout}\n${stderr}`.trim();

  return {
    authenticated: exitCode === 0 && !/not logged in/i.test(output),
    details: output || "Unknown Codex auth status",
  };
}

export async function startCodexDeviceAuth() {
  if (authChallenge && authProcess && !authProcess.killed) {
    return authChallenge;
  }

  authChallenge = null;
  authOutput = "";
  authProcess = Bun.spawn(["bunx", "codex", "login", "--device-auth"], {
    stderr: "pipe",
    stdout: "pipe",
  });

  void readStream(readablePipe(authProcess.stdout), (chunk) => {
    authOutput += chunk;
    authChallenge = authChallenge ?? parseAuthChallenge(authOutput);
  });
  void readStream(readablePipe(authProcess.stderr), (chunk) => {
    authOutput += chunk;
    authChallenge = authChallenge ?? parseAuthChallenge(authOutput);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (authChallenge) {
      return authChallenge;
    }

    await Bun.sleep(100);
  }

  throw new Error(
    authOutput
      ? `Codex did not return a device auth challenge. Output: ${stripAnsi(authOutput).trim()}`
      : "Codex did not return a device auth challenge",
  );
}
