/**
 * Example Maestro MCP Plugin
 *
 * This file demonstrates how to create a plugin that extends the MCP server
 * with custom tools. It is NOT loaded by default — it serves as a reference
 * for plugin authors.
 *
 * To use as a local plugin, add to `.maestro-mcp/plugins.json`:
 * ```json
 * {
 *   "plugins": [
 *     { "path": "./src/plugins/example-plugin.js", "enabled": true }
 *   ]
 * }
 * ```
 */

import type { MaestroPlugin, PluginContext } from "./types.js";

const examplePlugin: MaestroPlugin = {
  name: "example-plugin",
  version: "1.0.0",

  register(context: PluginContext): void {
    const { server } = context;

    // Register a simple tool
    server.tool(
      "hello_world",
      "A demo tool from the example plugin — returns a greeting",
      {},
      async () => {
        return {
          content: [{ type: "text", text: "Hello from plugin!" }],
        };
      }
    );

    // Example: use context.maestro to check Maestro status
    server.tool(
      "example_maestro_version",
      "Demo tool that reads the Maestro CLI version via the plugin context",
      {},
      async () => {
        const installed = await context.maestro.isInstalled();
        if (!installed) {
          return {
            content: [{ type: "text", text: "Maestro is not installed" }],
            isError: true,
          };
        }
        const version = await context.maestro.version();
        return {
          content: [
            {
              type: "text",
              text: `Maestro version: ${version} (reported by example-plugin)`,
            },
          ],
        };
      }
    );
  },
};

export default examplePlugin;
