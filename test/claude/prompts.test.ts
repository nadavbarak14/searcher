import { describe, it, expect } from "vitest";
import { BRANCH_SYSTEM, ROOT_SYSTEM, rootPrompt, branchPrompt, synthesizePrompt } from "../../src/claude/prompts.js";

describe("prompts", () => {
  it("system prompts mention the SEARCHER_META protocol", () => {
    expect(BRANCH_SYSTEM).toContain("SEARCHER_META");
    expect(ROOT_SYSTEM).toContain("SEARCHER_META");
    expect(ROOT_SYSTEM).toContain("summary");
    expect(ROOT_SYSTEM).toContain("nodes");
  });
  it("rootPrompt includes the topic", () => {
    expect(rootPrompt("AI security")).toContain("AI security");
  });
  it("branchPrompt includes topic, selection, question and ancestor titles", () => {
    const p = branchPrompt({ topic: "AI security", selection: "adversarial examples", question: "why transfer?", ancestorTitles: ["What are adversarial examples?"] });
    expect(p).toContain("AI security");
    expect(p).toContain("adversarial examples");
    expect(p).toContain("why transfer?");
    expect(p).toContain("What are adversarial examples?");
  });
  it("BRANCH_SYSTEM tells Claude it is continuing one project using the brief", () => {
    expect(BRANCH_SYSTEM).toContain("research brief");
  });
  it("branchPrompt prepends the brief when one is given", () => {
    const p = branchPrompt({ topic: "AI security", selection: "x", question: "q", ancestorTitles: [], brief: "RESEARCH GOAL: AI security" });
    expect(p).toContain("RESEARCH GOAL: AI security");
    // the brief comes before the per-question detail
    expect(p.indexOf("RESEARCH GOAL")).toBeLessThan(p.indexOf("My question"));
  });
  it("synthesizePrompt includes the topic", () => {
    expect(synthesizePrompt("AI security")).toContain("AI security");
  });
});
