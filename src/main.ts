import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "./config.js";
import { buildApp } from "./server/app.js";
import { ResearchService } from "./service.js";
import { preflight } from "./claude/preflight.js";

const execFileP = promisify(execFile);

async function claudePresent(): Promise<boolean> {
  try {
    await execFileP("claude", ["--version"], { shell: false });
    return true;
  } catch {
    return false;
  }
}

export interface StartOptions {
  port: number;
  dataDir: string;
  openBrowser?: boolean;
  publicDir?: string;
}

export async function startServer(opts: StartOptions): Promise<{ app: FastifyInstance; url: string }> {
  const service = new ResearchService(opts.dataDir);
  const app = buildApp({ dataDir: opts.dataDir, service, publicDir: opts.publicDir ?? path.resolve(process.cwd(), "public") });
  const address = await app.listen({ port: opts.port, host: "127.0.0.1" });
  const url = address.replace("127.0.0.1", "localhost");
  if (opts.openBrowser) {
    const open = (await import("open")).default;
    await open(url).catch(() => {});
  }
  return { app, url };
}

export async function main(): Promise<void> {
  const cfg = resolveConfig(process.env);
  const pf = await preflight({ env: process.env, checkClaude: claudePresent });
  if (!pf.ok) {
    console.error("Searcher cannot start:\n" + pf.errors.map((e) => "  - " + e).join("\n"));
    process.exit(1);
  }
  const { url } = await startServer({ port: cfg.port, dataDir: cfg.dataDir, openBrowser: true });
  console.log(`Searcher running at ${url}  (data: ${cfg.dataDir})`);
}

const isDirect = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
