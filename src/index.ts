#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  // Ensure Android SDK tools and Maestro are discoverable
  const home = process.env.HOME || "";
  const androidHome = process.env.ANDROID_HOME || `${home}/Library/Android/sdk`;
  const maestroHome = `${home}/.maestro/bin`;

  const extraPaths = [
    `${androidHome}/platform-tools`,
    `${androidHome}/emulator`,
    maestroHome,
  ].filter((p) => !process.env.PATH?.includes(p));

  if (extraPaths.length) {
    process.env.PATH = `${extraPaths.join(":")}:${process.env.PATH}`;
  }
  if (!process.env.ANDROID_HOME) {
    process.env.ANDROID_HOME = androidHome;
  }

  const { server, pluginResults } = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("maestro-mcp server running on stdio");
  if (pluginResults.loaded.length > 0) {
    console.error(`  plugins: ${pluginResults.loaded.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
