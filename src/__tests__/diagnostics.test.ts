import { describe, it, expect } from "vitest";
import {
  analyzeFlowFailure,
  parseDebugOutputDir,
  formatDiagnostics,
} from "../diagnostics/error-patterns.js";

describe("analyzeFlowFailure", () => {
  it("detects Metro bundler error", () => {
    const result = analyzeFlowFailure(
      "Unable to load script. Make sure you're running Metro or that your bundle 'index.android.bundle' is packaged correctly",
      []
    );
    expect(result[0].category).toBe("metro");
    expect(result[0].severity).toBe("critical");
  });

  it("detects element not found", () => {
    const result = analyzeFlowFailure(
      'Element not found: Text matching regex: Sign In',
      []
    );
    expect(result[0].category).toBe("element");
  });

  it("detects app crash", () => {
    const result = analyzeFlowFailure(
      "Application com.test.app has stopped",
      []
    );
    expect(result[0].category).toBe("app_crash");
    expect(result[0].severity).toBe("critical");
  });

  it("detects ANR", () => {
    const result = analyzeFlowFailure("", ["FATAL EXCEPTION: main"]);
    expect(result[0].category).toBe("app_crash");
  });

  it("detects timeout", () => {
    const result = analyzeFlowFailure("Operation timed out after 30000ms", []);
    expect(result[0].category).toBe("timeout");
  });

  it("detects network error", () => {
    const result = analyzeFlowFailure("API request error: Network Error", []);
    expect(result[0].category).toBe("network");
  });

  it("detects YAML parse error", () => {
    const result = analyzeFlowFailure("Parsing Failed", []);
    expect(result[0].category).toBe("parse");
  });

  it("detects no device", () => {
    const result = analyzeFlowFailure("no devices found", []);
    expect(result[0].category).toBe("device");
    expect(result[0].severity).toBe("critical");
  });

  it("returns unknown for unrecognized error", () => {
    const result = analyzeFlowFailure("something weird happened", []);
    expect(result[0].category).toBe("unknown");
  });

  it("detects multiple issues", () => {
    const result = analyzeFlowFailure(
      "Network Error\nOperation timed out",
      []
    );
    expect(result.length).toBe(2);
    const categories = result.map((d) => d.category);
    expect(categories).toContain("network");
    expect(categories).toContain("timeout");
  });

  it("combines output and errors", () => {
    const result = analyzeFlowFailure("", ["ECONNREFUSED"]);
    expect(result[0].category).toBe("network");
  });
});

describe("parseDebugOutputDir", () => {
  it("parses debug path from Maestro output", () => {
    const output = `Running on Pixel_8
> Flow test
Tap on "Login"... FAILED

==== Debug output (logs & screenshots) ====

/Users/test/.maestro/tests/2026-04-15_123456`;
    expect(parseDebugOutputDir(output)).toBe("/Users/test/.maestro/tests/2026-04-15_123456");
  });

  it("parses path without header", () => {
    const output = "Error at /Users/test/.maestro/tests/2026-04-15_000000 something";
    expect(parseDebugOutputDir(output)).toBe("/Users/test/.maestro/tests/2026-04-15_000000");
  });

  it("returns null when no path found", () => {
    expect(parseDebugOutputDir("just an error")).toBeNull();
  });
});

describe("formatDiagnostics", () => {
  it("returns empty string for no diagnostics", () => {
    expect(formatDiagnostics([])).toBe("");
  });

  it("formats critical with red icon", () => {
    const result = formatDiagnostics([{
      category: "metro",
      problem: "Metro not connected",
      suggestions: ["Start Metro"],
      severity: "critical",
    }]);
    expect(result).toContain("🔴");
    expect(result).toContain("[METRO]");
    expect(result).toContain("Start Metro");
  });

  it("formats error with orange icon", () => {
    const result = formatDiagnostics([{
      category: "element",
      problem: "Not found",
      suggestions: ["Check text"],
      severity: "error",
    }]);
    expect(result).toContain("🟠");
  });

  it("formats warning with yellow icon", () => {
    const result = formatDiagnostics([{
      category: "network",
      problem: "Slow",
      suggestions: ["Check connection"],
      severity: "warning",
    }]);
    expect(result).toContain("🟡");
  });
});
