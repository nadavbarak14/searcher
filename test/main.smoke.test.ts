import { describe, it, expect } from "vitest";
import { startServer } from "../src/main.js";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

describe("startServer", () => {
  it("starts, serves /, and stops (no browser open in test)", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-main-"));
    const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-mpub-"));
    await fs.writeFile(path.join(publicDir, "index.html"), "<!doctype html><title>Searcher</title>");
    const { app, url } = await startServer({ port: 0, dataDir, publicDir, openBrowser: false });
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(publicDir, { recursive: true, force: true });
  });
});
