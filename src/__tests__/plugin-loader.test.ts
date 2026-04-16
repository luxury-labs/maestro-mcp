import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadPlugins } from "../plugins/loader.js";
import type { PluginContext } from "../plugins/types.js";

/**
 * Build a minimal PluginContext stub for testing.
 * We don't need real Maestro/iOS/Android instances — plugins under test
 * only interact with the `server` stub.
 */
function makeStubContext(): PluginContext {
  return {
    maestro: {} as PluginContext["maestro"],
    iosSim: {} as PluginContext["iosSim"],
    androidDev: {} as PluginContext["androidDev"],
    server: { tool: vi.fn() } as unknown as PluginContext["server"],
  };
}

describe("loadPlugins", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-mcp-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty results when no config and no node_modules", async () => {
    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads a plugin from a local file", async () => {
    // Write a minimal plugin module
    const pluginDir = path.join(tmpDir, "my-plugin");
    await fs.mkdir(pluginDir, { recursive: true });

    const pluginCode = `
      const plugin = {
        name: "test-local-plugin",
        version: "0.1.0",
        register(ctx) {
          ctx.server.tool("test_tool", "A test tool", {}, async () => ({
            content: [{ type: "text", text: "ok" }],
          }));
        },
      };
      export default plugin;
    `;
    await fs.writeFile(path.join(pluginDir, "plugin.mjs"), pluginCode);

    // Write config pointing to the local plugin
    const configDir = path.join(tmpDir, ".maestro-mcp");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "plugins.json"),
      JSON.stringify({
        plugins: [{ path: "./my-plugin/plugin.mjs", enabled: true }],
      })
    );

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual(["test-local-plugin"]);
    expect(result.errors).toEqual([]);
    expect(ctx.server.tool).toHaveBeenCalledOnce();
  });

  it("handles missing plugin file gracefully", async () => {
    const configDir = path.join(tmpDir, ".maestro-mcp");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "plugins.json"),
      JSON.stringify({
        plugins: [{ path: "./does-not-exist.mjs", enabled: true }],
      })
    );

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe("./does-not-exist.mjs");
    expect(result.errors[0].error).toBeTruthy();
  });

  it("handles plugin that throws during register", async () => {
    const pluginDir = path.join(tmpDir, "bad-plugin");
    await fs.mkdir(pluginDir, { recursive: true });

    const pluginCode = `
      const plugin = {
        name: "bad-plugin",
        version: "0.0.1",
        register() {
          throw new Error("Plugin init exploded");
        },
      };
      export default plugin;
    `;
    await fs.writeFile(path.join(pluginDir, "index.mjs"), pluginCode);

    const configDir = path.join(tmpDir, ".maestro-mcp");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "plugins.json"),
      JSON.stringify({
        plugins: [{ path: "./bad-plugin/index.mjs", enabled: true }],
      })
    );

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toContain("bad-plugin");
    expect(result.errors[0].error).toBe("Plugin init exploded");
  });

  it("skips disabled plugins", async () => {
    const pluginDir = path.join(tmpDir, "skipped");
    await fs.mkdir(pluginDir, { recursive: true });

    const pluginCode = `
      const plugin = {
        name: "skipped-plugin",
        version: "1.0.0",
        register() { throw new Error("Should not be called"); },
      };
      export default plugin;
    `;
    await fs.writeFile(path.join(pluginDir, "index.mjs"), pluginCode);

    const configDir = path.join(tmpDir, ".maestro-mcp");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "plugins.json"),
      JSON.stringify({
        plugins: [{ path: "./skipped/index.mjs", enabled: false }],
      })
    );

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("auto-discovers plugins from node_modules by keyword", async () => {
    // Create a fake node_modules package with the right keyword
    const pkgDir = path.join(tmpDir, "node_modules", "maestro-mcp-plugin-test");
    await fs.mkdir(pkgDir, { recursive: true });

    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "maestro-mcp-plugin-test",
        version: "1.0.0",
        keywords: ["maestro-mcp-plugin"],
        type: "module",
        main: "index.mjs",
      })
    );

    const pluginCode = `
      const plugin = {
        name: "auto-discovered",
        version: "1.0.0",
        register(ctx) {
          ctx.server.tool("auto_tool", "Discovered tool", {}, async () => ({
            content: [{ type: "text", text: "discovered" }],
          }));
        },
      };
      export default plugin;
    `;
    await fs.writeFile(path.join(pkgDir, "index.mjs"), pluginCode);

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual(["auto-discovered"]);
    expect(result.errors).toEqual([]);
  });

  it("does not auto-discover packages without the keyword", async () => {
    const pkgDir = path.join(tmpDir, "node_modules", "some-other-package");
    await fs.mkdir(pkgDir, { recursive: true });

    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "some-other-package",
        version: "1.0.0",
        keywords: ["unrelated"],
        type: "module",
        main: "index.mjs",
      })
    );

    const pluginCode = `export default { name: "not-a-plugin", version: "1.0.0", register() {} };`;
    await fs.writeFile(path.join(pkgDir, "index.mjs"), pluginCode);

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads multiple plugins and reports mixed results", async () => {
    // Good plugin
    const goodDir = path.join(tmpDir, "good-plugin");
    await fs.mkdir(goodDir, { recursive: true });
    await fs.writeFile(
      path.join(goodDir, "index.mjs"),
      `export default { name: "good", version: "1.0.0", register() {} };`
    );

    // Bad plugin
    const badDir = path.join(tmpDir, "bad-plugin");
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(
      path.join(badDir, "index.mjs"),
      `export default { name: "bad", version: "1.0.0", register() { throw new Error("boom"); } };`
    );

    const configDir = path.join(tmpDir, ".maestro-mcp");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "plugins.json"),
      JSON.stringify({
        plugins: [
          { path: "./good-plugin/index.mjs", enabled: true },
          { path: "./bad-plugin/index.mjs", enabled: true },
        ],
      })
    );

    const ctx = makeStubContext();
    const result = await loadPlugins(ctx, tmpDir);

    expect(result.loaded).toEqual(["good"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe("boom");
  });
});
