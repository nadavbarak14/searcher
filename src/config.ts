import os from "node:os";
import path from "node:path";

export interface Config {
  port: number;
  dataDir: string;
}
const DEFAULT_PORT = 4317;

export function resolveConfig(env: Record<string, string | undefined>): Config {
  const parsedPort = Number(env.SEARCHER_PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  const dataDir = env.SEARCHER_DATA_DIR ?? path.join(os.homedir(), "Searcher");
  return { port, dataDir };
}
