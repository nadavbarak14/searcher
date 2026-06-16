import path from "node:path";

/** Absolute folder for one research project. */
export function projectDir(baseDir: string, projectId: string): string {
  return path.join(baseDir, projectId);
}

/** Absolute path to a node's markdown file. */
export function nodePath(baseDir: string, projectId: string, nodeId: string): string {
  return path.join(baseDir, projectId, `${nodeId}.md`);
}

/** Absolute path to a project's index file. */
export function indexPath(baseDir: string, projectId: string): string {
  return path.join(baseDir, projectId, "graph.json");
}

/** Absolute path to a project's saved synthesis. NOT a `.md` file, so rebuildIndex() (which
 *  scans `*.md` as nodes) and the synthesis Claude run (which reads `*.md`) both ignore it. */
export function reportPath(baseDir: string, projectId: string): string {
  return path.join(baseDir, projectId, "report.json");
}
