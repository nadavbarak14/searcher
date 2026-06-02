import { describe, it, expect } from "vitest";
import { splitMeta } from "../../src/claude/meta.js";

describe("splitMeta", () => {
  it("extracts the answer and parsed meta json", () => {
    const reply = ["Adversarial examples transfer because models share features.", "", "<<<SEARCHER_META", '{"claims":["models share features"],"sources":["https://a.test"]}', "SEARCHER_META>>>"].join("\n");
    const { answer, meta } = splitMeta(reply);
    expect(answer).toBe("Adversarial examples transfer because models share features.");
    expect(meta).toEqual({ claims: ["models share features"], sources: ["https://a.test"] });
  });
  it("returns the whole text as answer and null meta when no block present", () => {
    const { answer, meta } = splitMeta("just an answer");
    expect(answer).toBe("just an answer");
    expect(meta).toBeNull();
  });
  it("returns null meta when the block contains invalid json (answer still recovered)", () => {
    const reply = "Ans.\n<<<SEARCHER_META\nnot json\nSEARCHER_META>>>";
    const { answer, meta } = splitMeta(reply);
    expect(answer).toBe("Ans.");
    expect(meta).toBeNull();
  });
});
