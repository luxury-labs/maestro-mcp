import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MaestroCli } from "../maestro/cli.js";
import type { IOSSimulator } from "../maestro/ios-simulator.js";
import type { AndroidDevice } from "../maestro/android-device.js";

export interface PluginContext {
  maestro: MaestroCli;
  iosSim: IOSSimulator;
  androidDev: AndroidDevice;
  server: McpServer;
}

export interface MaestroPlugin {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Register tools on the MCP server */
  register(context: PluginContext): void | Promise<void>;
}

export interface PluginConfigEntry {
  /** npm package name */
  package?: string;
  /** Local file path (relative to project root or absolute) */
  path?: string;
  /** Whether this plugin is enabled (default: true) */
  enabled?: boolean;
}

export interface PluginConfig {
  plugins: PluginConfigEntry[];
}

export interface LoadPluginsResult {
  loaded: string[];
  errors: Array<{ name: string; error: string }>;
}
