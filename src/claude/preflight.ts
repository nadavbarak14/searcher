import { API_KEY_VARS } from "./env.js";

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}
export interface PreflightDeps {
  env: Record<string, string | undefined>;
  checkClaude: () => Promise<boolean>;
}

export async function preflight(deps: PreflightDeps): Promise<PreflightResult> {
  const errors: string[] = [];
  for (const v of API_KEY_VARS) {
    if (deps.env[v]) {
      errors.push(`${v} is set — this would bill metered API usage. Unset it so Searcher uses your Claude subscription.`);
    }
  }
  if (!(await deps.checkClaude())) {
    errors.push("The `claude` CLI was not found. Install Claude Code and log in with your subscription (`claude` then /login).");
  }
  return { ok: errors.length === 0, errors };
}
