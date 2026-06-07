import { describe, it, expect } from "vitest";
import { buildBrief } from "../../src/research/brief.js";

describe("buildBrief", () => {
  it("always states the research goal", () => {
    const b = buildBrief({ goal: "AI security", findings: [] });
    expect(b).toContain("RESEARCH GOAL: AI security");
  });

  it("marks the empty state when there are no findings yet", () => {
    const b = buildBrief({ goal: "AI security", findings: [] });
    expect(b).toContain("nothing yet");
  });

  it("lists each finding as `question — first-sentence takeaway`", () => {
    const b = buildBrief({
      goal: "AI security",
      findings: [
        { question: "What are adversarial examples?", body: "Inputs crafted to fool a model. They exploit decision boundaries." },
      ],
    });
    expect(b).toContain("- What are adversarial examples? — Inputs crafted to fool a model.");
    // only the FIRST sentence is used as the takeaway
    expect(b).not.toContain("exploit decision boundaries");
  });

  it("falls back to just the question when the body is empty", () => {
    const b = buildBrief({ goal: "G", findings: [{ question: "Open question?", body: "" }] });
    expect(b).toContain("- Open question?");
  });

  it("caps an over-long takeaway with an ellipsis", () => {
    const long = "x".repeat(500) + ".";
    const b = buildBrief({ goal: "G", findings: [{ question: "Q", body: long }] });
    const line = b.split("\n").find((l) => l.startsWith("- Q")) ?? "";
    expect(line.length).toBeLessThan(200);
    expect(line).toContain("…");
  });

  it("caps the number of findings and notes the omission", () => {
    const findings = Array.from({ length: 50 }, (_, i) => ({ question: `Q${i}`, body: `B${i}.` }));
    const b = buildBrief({ goal: "G", findings });
    expect(b).toContain("earlier finding(s) omitted");
    // the most recent finding is kept, the oldest is dropped
    expect(b).toContain("- Q49 — B49.");
    expect(b).not.toContain("- Q0 — B0.");
  });
});
