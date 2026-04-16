import { describe, it, expect } from "vitest";
import { ensureDirs, getPath } from "../utils/temp-files.js";
import fs from "node:fs/promises";
import path from "node:path";

describe("temp-files", () => {
  it("ensureDirs creates directories", async () => {
    await ensureDirs();
    const base = path.join(process.cwd(), ".maestro-mcp");
    const flowsStat = await fs.stat(path.join(base, "flows"));
    const shotsStat = await fs.stat(path.join(base, "screenshots"));
    const tmpStat = await fs.stat(path.join(base, "tmp"));
    expect(flowsStat.isDirectory()).toBe(true);
    expect(shotsStat.isDirectory()).toBe(true);
    expect(tmpStat.isDirectory()).toBe(true);
  });

  it("getPath returns correct path", () => {
    const result = getPath("flows", "test.yaml");
    expect(result).toContain(".maestro-mcp");
    expect(result).toContain("flows");
    expect(result).toContain("test.yaml");
  });
});
