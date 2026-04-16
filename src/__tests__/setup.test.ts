import { describe, it, expect } from "vitest";
import { runSetup } from "../utils/setup.js";

describe("runSetup", () => {
  it("returns check results with expected structure", async () => {
    const result = await runSetup();
    expect(result.checks).toBeInstanceOf(Array);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.devices).toBeInstanceOf(Array);
    expect(typeof result.ready).toBe("boolean");
    expect(typeof result.summary).toBe("string");
  });

  it("each check has name and status", async () => {
    const result = await runSetup();
    for (const check of result.checks) {
      expect(check.name).toBeTruthy();
      expect(["ok", "missing", "error"]).toContain(check.status);
    }
  });

  it("checks Node.js (should always be ok)", async () => {
    const result = await runSetup();
    const nodeCheck = result.checks.find((c) => c.name === "Node.js");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe("ok");
    expect(nodeCheck!.version).toMatch(/^v\d+/);
  });

  it("checks at least 5 tools", async () => {
    const result = await runSetup();
    expect(result.checks.length).toBeGreaterThanOrEqual(5);
  });
});
