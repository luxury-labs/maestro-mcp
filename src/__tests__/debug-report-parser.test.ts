import { describe, it, expect } from "vitest";
import { parseCommandsJson } from "../diagnostics/debug-report-parser.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TMP = path.join(os.tmpdir(), "maestro-mcp-debug-tests");

async function createDebugDir(
  commands: Array<{
    command: Record<string, unknown>;
    metadata: { status: string; timestamp: number; duration: number; error?: unknown };
  }>
): Promise<string> {
  const dir = path.join(TMP, `debug-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "commands-(test.yaml).json"),
    JSON.stringify(commands)
  );
  return dir;
}

describe("parseCommandsJson", () => {
  it("parses completed commands", async () => {
    const dir = await createDebugDir([
      {
        command: { launchAppCommand: { appId: "com.test" } },
        metadata: { status: "COMPLETED", timestamp: 1, duration: 500 },
      },
      {
        command: { waitForAnimationToEndCommand: {} },
        metadata: { status: "COMPLETED", timestamp: 2, duration: 200 },
      },
    ]);

    const result = await parseCommandsJson(dir);
    expect(result).not.toBeNull();
    expect(result!.completedCommands).toHaveLength(2);
    expect(result!.completedCommands[0]).toBe("launchApp: com.test");
    expect(result!.completedCommands[1]).toBe("waitForAnimationToEnd");
    expect(result!.failedCommand).toBeUndefined();
  });

  it("parses failed command with error", async () => {
    const dir = await createDebugDir([
      {
        command: { launchAppCommand: { appId: "com.test" } },
        metadata: { status: "COMPLETED", timestamp: 1, duration: 100 },
      },
      {
        command: { tapOnElement: { selector: { textRegex: "Sign In" } } },
        metadata: {
          status: "FAILED",
          timestamp: 2,
          duration: 5000,
          error: { message: "Element not found" },
        },
      },
    ]);

    const result = await parseCommandsJson(dir);
    expect(result!.completedCommands).toHaveLength(1);
    expect(result!.failedCommand).toBeDefined();
    expect(result!.failedCommand!.description).toBe('tapOn: "Sign In"');
    expect(result!.failedCommand!.error).toBe("Element not found");
    expect(result!.failedCommand!.duration).toBe(5000);
  });

  it("extracts visible texts from hierarchy", async () => {
    const dir = await createDebugDir([
      {
        command: { tapOnElement: { selector: { textRegex: "Login" } } },
        metadata: {
          status: "FAILED",
          timestamp: 1,
          duration: 3000,
          error: {
            message: "Not found",
            hierarchyRoot: {
              attributes: { text: "Welcome" },
              children: [
                { attributes: { text: "Email" } },
                { attributes: { text: "" } },
                {
                  attributes: {},
                  children: [{ attributes: { text: "Password" } }],
                },
              ],
            },
          },
        },
      },
    ]);

    const result = await parseCommandsJson(dir);
    const texts = result!.failedCommand!.visibleTexts;
    expect(texts).toContain("Welcome");
    expect(texts).toContain("Email");
    expect(texts).toContain("Password");
    expect(texts).not.toContain("");
  });

  it("returns null for missing dir", async () => {
    const result = await parseCommandsJson("/nonexistent/dir");
    expect(result).toBeNull();
  });

  it("returns null when no commands file exists", async () => {
    const dir = path.join(TMP, `empty-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const result = await parseCommandsJson(dir);
    expect(result).toBeNull();
  });

  it("describes various command types", async () => {
    const dir = await createDebugDir([
      { command: { inputTextCommand: { text: "hello" } }, metadata: { status: "COMPLETED", timestamp: 1, duration: 100 } },
      { command: { assertConditionCommand: {} }, metadata: { status: "COMPLETED", timestamp: 2, duration: 50 } },
      { command: { swipeCommand: {} }, metadata: { status: "COMPLETED", timestamp: 3, duration: 100 } },
      { command: { scrollCommand: {} }, metadata: { status: "COMPLETED", timestamp: 4, duration: 100 } },
      { command: { backPressCommand: {} }, metadata: { status: "COMPLETED", timestamp: 5, duration: 50 } },
      { command: { hideKeyboardCommand: {} }, metadata: { status: "COMPLETED", timestamp: 6, duration: 50 } },
      { command: { takeScreenshotCommand: { path: "shot.png" } }, metadata: { status: "COMPLETED", timestamp: 7, duration: 200 } },
      { command: { unknownFancyCommand: {} }, metadata: { status: "COMPLETED", timestamp: 8, duration: 10 } },
    ]);

    const result = await parseCommandsJson(dir);
    expect(result!.completedCommands).toEqual([
      'inputText: "hello"',
      "assertVisible",
      "swipe",
      "scroll",
      "back",
      "hideKeyboard",
      "takeScreenshot: shot.png",
      "unknownFancy",
    ]);
  });
});
