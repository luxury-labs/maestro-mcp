import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MaestroCli } from "./maestro/cli.js";
import { IOSSimulator } from "./maestro/ios-simulator.js";
import { AndroidDevice, ANDROID_PERMISSIONS } from "./maestro/android-device.js";
import {
  createTempFlow,
  deleteTempFlow,
  cleanTempFlows,
  generateLoginFlow,
  generateNavigationFlow,
  generateScrollSearchFlow,
  generateFormFlow,
  adaptStepsForPlatform,
} from "./generators/yaml-generator.js";
import { ensureDirs } from "./utils/temp-files.js";
import type { FlowStep, FlowConfig, MaestroFlowResult } from "./maestro/types.js";
import { analyzeFlowFailure, formatDiagnostics } from "./diagnostics/error-patterns.js";
import { scanProject, analyzeFile } from "./analyzers/project-scanner.js";
import { runSetup, installTool } from "./utils/setup.js";
import { loadPlugins } from "./plugins/loader.js";
import type { PluginContext, MaestroPlugin, LoadPluginsResult } from "./plugins/types.js";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: "image/jpeg" };
type ContentBlock = TextContent | ImageContent;

/**
 * Build enriched MCP response content for a failed flow.
 * Includes: result JSON, failure screenshots as images, and text diagnostics.
 */
function buildFailureResponse(
  result: MaestroFlowResult,
  extra?: Record<string, unknown>
): { content: ContentBlock[]; isError: boolean } {
  const content: ContentBlock[] = [];

  // 1. JSON result (without base64 blobs to keep it readable)
  const { failureScreenshots, debugReport, ...resultCompact } = result;
  content.push({
    type: "text" as const,
    text: JSON.stringify({ ...resultCompact, ...extra }, null, 2),
  });

  // 2. Debug report with failed command details + visible UI texts
  if (debugReport) {
    const reportLines: string[] = ["## Maestro Debug Report\n"];
    if (debugReport.completedCommands.length > 0) {
      reportLines.push(`Completed steps: ${debugReport.completedCommands.join(" → ")}`);
    }
    if (debugReport.failedCommand) {
      const fc = debugReport.failedCommand;
      reportLines.push(`\nFailed at: **${fc.description}** (${fc.duration}ms)`);
      reportLines.push(`Error: ${fc.error}`);
      if (fc.visibleTexts.length > 0) {
        reportLines.push("\nVisible text on screen at failure:");
        for (const t of fc.visibleTexts) {
          reportLines.push(`  - "${t}"`);
        }
      }
    }
    content.push({ type: "text" as const, text: reportLines.join("\n") });
  }

  // 3. Failure screenshots as images — LLM can visually analyze these
  if (failureScreenshots && failureScreenshots.length > 0) {
    for (const shot of failureScreenshots) {
      content.push({
        type: "image" as const,
        data: shot.base64,
        mimeType: "image/jpeg" as const,
      });
      content.push({
        type: "text" as const,
        text: `Failure screenshot: ${shot.path}`,
      });
    }
  }

  // 4. Text-based diagnostics from pattern matching
  const diagnostics = analyzeFlowFailure(result.output, result.errors);
  const diagnosticText = formatDiagnostics(diagnostics);
  if (diagnosticText) {
    content.push({ type: "text" as const, text: diagnosticText });
  }

  return { content, isError: true };
}

export { type PluginContext, type MaestroPlugin };

export async function createServer(): Promise<{
  server: McpServer;
  pluginResults: LoadPluginsResult;
}> {
  const server = new McpServer({
    name: "maestro-mcp",
    version: "0.1.0",
  });

  const maestro = new MaestroCli();
  const iosSim = new IOSSimulator();
  const androidDev = new AndroidDevice();

  // ────────────────────────────────────────────
  // TOOL: maestro_status
  // ────────────────────────────────────────────
  server.tool(
    "maestro_status",
    "Check if Maestro CLI is installed, get version, and list connected devices",
    {},
    async () => {
      await ensureDirs();
      const installed = await maestro.isInstalled();
      if (!installed) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                installed: false,
                error:
                  "Maestro CLI not found. Install: curl -Ls 'https://get.maestro.mobile.dev' | bash",
              }),
            },
          ],
        };
      }

      const [version, devices] = await Promise.all([
        maestro.version(),
        maestro.listDevices(),
      ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ installed: true, version, devices }, null, 2),
          },
        ],
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: setup
  // ────────────────────────────────────────────
  server.tool(
    "setup",
    "Check environment and install required tools for mobile E2E testing. Verifies: Node.js, Maestro CLI, Android SDK/ADB, Android Emulator, Xcode/simctl, Java, idb_companion. Shows connected devices. Use autoInstall=true to auto-install Maestro, Java, and idb_companion.",
    {
      autoInstall: z.boolean().optional().default(false).describe("Auto-install missing tools that support it (Maestro, Java, idb_companion)"),
    },
    async ({ autoInstall }) => {
      const result = await runSetup({ autoInstall });

      const lines: string[] = ["# Maestro MCP Setup\n"];

      for (const check of result.checks) {
        const icon = check.status === "ok" ? "✅" : "❌";
        lines.push(`${icon} **${check.name}**${check.version ? ` — ${check.version}` : ""}`);
        if (check.message) lines.push(`   ${check.message}`);
        if (check.status === "missing" && check.installCmd) {
          lines.push(`   Install: \`${check.installCmd}\``);
        }
      }

      if (result.devices.length > 0) {
        lines.push("\n## Connected Devices\n");
        for (const d of result.devices) {
          lines.push(`- **${d.name}** (${d.platform}) — ${d.id}`);
        }
      } else {
        lines.push("\n⚠️ No devices connected. Start an emulator or simulator.");
      }

      lines.push(`\n---\n${result.ready ? "✅ Ready to test!" : "❌ Install missing tools first."}`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: install_tool
  // ────────────────────────────────────────────
  server.tool(
    "install_tool",
    "Install a specific tool required by maestro-mcp. Supported: maestro, java, idb_companion.",
    {
      tool: z.enum(["maestro", "java", "idb_companion"]).describe("Tool to install"),
    },
    async ({ tool }) => {
      const result = await installTool(tool);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: list_devices
  // ────────────────────────────────────────────
  server.tool(
    "list_devices",
    "List all connected Android and iOS devices/emulators",
    {},
    async () => {
      const devices = await maestro.listDevices();
      return {
        content: [
          { type: "text", text: JSON.stringify(devices, null, 2) },
        ],
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: device_info
  // ────────────────────────────────────────────
  server.tool(
    "device_info",
    "Get detailed info about a specific device",
    { deviceId: z.string().describe("Device ID from list_devices") },
    async ({ deviceId }) => {
      const info = await maestro.getDeviceInfo(deviceId);
      if (!info) {
        return {
          content: [{ type: "text", text: `Device not found: ${deviceId}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: launch_app
  // ────────────────────────────────────────────
  server.tool(
    "launch_app",
    "Launch a mobile app by package/bundle ID",
    {
      appId: z.string().describe("App package (Android) or bundle ID (iOS), e.g. com.example.app"),
      deviceId: z.string().optional().describe("Target device ID. Omit for default device"),
      clearState: z.boolean().optional().describe("Clear app state before launch"),
    },
    async ({ appId, deviceId, clearState }) => {
      const result = await maestro.launchApp(appId, { deviceId, clearState });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: stop_app
  // ────────────────────────────────────────────
  server.tool(
    "stop_app",
    "Force stop a running app",
    {
      appId: z.string().describe("App package/bundle ID"),
      deviceId: z.string().optional().describe("Target device ID"),
    },
    async ({ appId, deviceId }) => {
      const result = await maestro.stopApp(appId, deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: install_app
  // ────────────────────────────────────────────
  server.tool(
    "install_app",
    "Install an APK or .app on a device/emulator",
    {
      appPath: z.string().describe("Path to .apk or .app file"),
      deviceId: z.string().optional().describe("Target device ID"),
    },
    async ({ appPath, deviceId }) => {
      const result = await maestro.installApp(appPath, deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: take_screenshot
  // ────────────────────────────────────────────
  server.tool(
    "take_screenshot",
    "Take a screenshot of the current device screen. Returns base64 JPEG image (sRGB).",
    {
      deviceId: z.string().optional().describe("Target device ID"),
      filename: z.string().optional().describe("Screenshot filename"),
    },
    async ({ deviceId, filename }) => {
      try {
        const result = await maestro.takeScreenshot(filename, deviceId);
        return {
          content: [
            {
              type: "image",
              data: result.base64,
              mimeType: "image/jpeg",
            },
            {
              type: "text",
              text: `Screenshot saved: ${result.path}`,
            },
          ],
        };
      } catch (err: unknown) {
        const error = err as { message?: string };
        return {
          content: [{ type: "text", text: `Screenshot failed: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: tap
  // ────────────────────────────────────────────
  server.tool(
    "tap",
    "Tap on an element by text, ID, or coordinates. Generates and runs a temporary Maestro flow.",
    {
      appId: z.string().describe("App package/bundle ID"),
      text: z.string().optional().describe("Text to tap on"),
      id: z.string().optional().describe("Element accessibility ID"),
      point: z.string().optional().describe("Coordinates as 'x,y' (e.g. '50%,50%')"),
      index: z.number().optional().describe("Index if multiple matches"),
      longPress: z.boolean().optional().describe("Long press instead of tap"),
      deviceId: z.string().optional().describe("Target device ID"),
    },
    async ({ appId, text, id, point, index, longPress, deviceId }) => {
      const steps: FlowStep[] = [
        { action: "tapOn", params: { text, id, point, index, longPress } },
        { action: "waitForAnimationToEnd", params: {} },
      ];

      const flow = await createTempFlow({ appId }, steps);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        if (!result.success) {
          return buildFailureResponse(result, { yaml: flow.yaml });
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result, yaml: flow.yaml }) }],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: input_text
  // ────────────────────────────────────────────
  server.tool(
    "input_text",
    "Type text into the focused field",
    {
      appId: z.string().describe("App package/bundle ID"),
      text: z.string().describe("Text to type"),
      deviceId: z.string().optional(),
    },
    async ({ appId, text, deviceId }) => {
      const steps: FlowStep[] = [
        { action: "inputText", params: { text } },
      ];

      const flow = await createTempFlow({ appId }, steps);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        if (!result.success) return buildFailureResponse(result);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: swipe
  // ────────────────────────────────────────────
  server.tool(
    "swipe",
    "Swipe in a direction or between two points",
    {
      appId: z.string().describe("App package/bundle ID"),
      direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]).optional().describe("Swipe direction"),
      from: z.string().optional().describe("Start point as 'x%,y%'"),
      to: z.string().optional().describe("End point as 'x%,y%'"),
      deviceId: z.string().optional(),
    },
    async ({ appId, direction, from, to, deviceId }) => {
      const steps: FlowStep[] = [
        { action: "swipe", params: { direction, from, to } },
        { action: "waitForAnimationToEnd", params: {} },
      ];

      const flow = await createTempFlow({ appId }, steps);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        if (!result.success) return buildFailureResponse(result);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: assert_visible
  // ────────────────────────────────────────────
  server.tool(
    "assert_visible",
    "Assert that an element is visible on screen",
    {
      appId: z.string().describe("App package/bundle ID"),
      text: z.string().optional().describe("Text that should be visible"),
      id: z.string().optional().describe("Element accessibility ID"),
      deviceId: z.string().optional(),
    },
    async ({ appId, text, id, deviceId }) => {
      const steps: FlowStep[] = [
        { action: "assertVisible", params: { text, id } },
      ];

      const flow = await createTempFlow({ appId }, steps);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        if (!result.success) {
          return buildFailureResponse(result, { assertTarget: text ?? id });
        }
        return {
          content: [
            {
              type: "text",
              text: `✓ Element visible: ${text ?? id}`,
            },
          ],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: scroll_to
  // ────────────────────────────────────────────
  server.tool(
    "scroll_to",
    "Scroll until an element becomes visible",
    {
      appId: z.string().describe("App package/bundle ID"),
      text: z.string().optional().describe("Text to scroll to"),
      id: z.string().optional().describe("Element accessibility ID"),
      direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]).optional().default("DOWN"),
      deviceId: z.string().optional(),
    },
    async ({ appId, text, id, direction, deviceId }) => {
      const steps: FlowStep[] = [
        { action: "scrollUntilVisible", params: { text, id, direction } },
      ];

      const flow = await createTempFlow({ appId }, steps);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        if (!result.success) return buildFailureResponse(result);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: press_back
  // ────────────────────────────────────────────
  server.tool(
    "press_back",
    "Navigate back. Android: presses back button. iOS: swipe from left edge (iOS has no back button).",
    {
      appId: z.string().describe("App package/bundle ID"),
      deviceId: z.string().optional(),
    },
    async ({ appId, deviceId }) => {
      const platform = deviceId ? MaestroCli.detectPlatform(deviceId) : "android";
      const steps: FlowStep[] = [{ action: "back", params: {} }];
      const adapted = adaptStepsForPlatform(steps, platform);
      const flow = await createTempFlow({ appId }, adapted);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        if (!result.success) return buildFailureResponse(result);
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: run_flow (execute raw YAML)
  // ────────────────────────────────────────────
  server.tool(
    "run_flow",
    "Run a Maestro flow from a YAML file path",
    {
      flowPath: z.string().describe("Path to .yaml flow file"),
      deviceId: z.string().optional(),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables for the flow"),
    },
    async ({ flowPath, deviceId, env }) => {
      const result = await maestro.runFlow(flowPath, { deviceId, env: env as Record<string, string> | undefined });

      if (!result.success) {
        return buildFailureResponse(result);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: generate_and_run_flow (autonomous)
  // ────────────────────────────────────────────
  server.tool(
    "generate_and_run_flow",
    "Auto-generate a Maestro YAML test flow from steps, execute it, and return results. The flow file is temporary and cleaned up after execution. This is the primary tool for autonomous mobile testing.",
    {
      appId: z.string().describe("App package/bundle ID"),
      name: z.string().optional().describe("Flow name for identification"),
      steps: z
        .array(
          z.object({
            action: z.enum([
              "launchApp", "tapOn", "inputText", "assertVisible", "assertNotVisible",
              "scrollUntilVisible", "swipe", "back", "hideKeyboard",
              "waitForAnimationToEnd", "takeScreenshot", "clearState", "openLink",
              "pressKey", "eraseText", "pasteText", "scroll", "waitUntilVisible",
              "stopApp", "clearKeychain", "setLocation", "evalScript",
            ]),
            params: z.record(z.string(), z.unknown()),
          })
        )
        .describe("Array of test steps to execute sequentially"),
      env: z.record(z.string(), z.string()).optional(),
      deviceId: z.string().optional(),
    },
    async ({ appId, name, steps, env, deviceId }) => {
      const envRecord = env as Record<string, string> | undefined;
      const config: FlowConfig = { appId, name, env: envRecord };

      // Auto-adapt steps for target platform (e.g. back → swipe on iOS)
      const platform = deviceId ? MaestroCli.detectPlatform(deviceId) : "android";
      const adaptedSteps = adaptStepsForPlatform(steps as FlowStep[], platform);
      const flow = await createTempFlow(config, adaptedSteps);

      try {
        const result = await maestro.runFlow(flow.path, { deviceId, env: envRecord });
        const extra = { generatedYaml: flow.yaml, flowName: name ?? "unnamed" };

        if (!result.success) {
          return buildFailureResponse(result, extra);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result, ...extra }, null, 2),
            },
          ],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: generate_test (template-based)
  // ────────────────────────────────────────────
  server.tool(
    "generate_test",
    "Auto-generate a complete test flow from a template (login, navigation, search, form). Generates YAML, runs it, returns results.",
    {
      appId: z.string().describe("App package/bundle ID"),
      template: z.enum(["login", "navigation", "search", "form"]).describe("Test template type"),
      params: z.record(z.string(), z.unknown()).describe(
        "Template parameters. Login: {username, password, usernameField?, passwordField?, loginButton?, expectedAfterLogin?}. " +
        "Navigation: {screens: [{name, tapTarget, assertVisible}]}. " +
        "Search: {searchTerm, searchFieldId?, expectedResult}. " +
        "Form: {fields: [{label, value, id?}], submitButton?, expectedAfterSubmit?}"
      ),
      deviceId: z.string().optional(),
    },
    async ({ appId, template, params, deviceId }) => {
      let config: FlowConfig;
      let steps: FlowStep[];

      switch (template) {
        case "login": {
          const p = params as {
            username: string;
            password: string;
            usernameField?: string;
            passwordField?: string;
            loginButton?: string;
            expectedAfterLogin?: string;
          };
          ({ config, steps } = generateLoginFlow(appId, p));
          break;
        }
        case "navigation": {
          const p = params as {
            screens: { name: string; tapTarget: string; assertVisible: string }[];
          };
          ({ config, steps } = generateNavigationFlow(appId, p.screens));
          break;
        }
        case "search": {
          const p = params as {
            searchTerm: string;
            searchFieldId?: string;
            expectedResult: string;
          };
          ({ config, steps } = generateScrollSearchFlow(appId, p));
          break;
        }
        case "form": {
          const p = params as {
            fields: { label: string; value: string; id?: string }[];
            submitButton?: string;
            expectedAfterSubmit?: string;
          };
          ({ config, steps } = generateFormFlow(appId, p.fields, p));
          break;
        }
      }

      const flow = await createTempFlow(config!, steps!);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        const extra = { template, generatedYaml: flow.yaml };

        if (!result.success) {
          return buildFailureResponse(result, extra);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result, ...extra }, null, 2),
            },
          ],
        };
      } finally {
        await deleteTempFlow(flow.path);
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: list_virtual_devices (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "list_virtual_devices",
    "List all available virtual devices — iOS simulators and Android AVDs. Shows both booted and shutdown devices.",
    {
      platform: z.enum(["all", "ios", "android"]).optional().default("all").describe("Filter by platform"),
    },
    async ({ platform }) => {
      const result: Record<string, unknown> = {};

      if (platform === "all" || platform === "ios") {
        const iosAvailable = await iosSim.isAvailable();
        if (iosAvailable) {
          result.ios = await iosSim.listSimulators({ includeShutdown: true });
        } else {
          result.ios = { error: "xcrun simctl not available" };
        }
      }

      if (platform === "all" || platform === "android") {
        const [avds, deviceTypes, systemImages] = await Promise.all([
          androidDev.listEmulators(),
          androidDev.listDeviceTypes(),
          androidDev.listSystemImages(),
        ]);
        result.android = { avds, deviceTypes, systemImages };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: boot_device (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "boot_device",
    "Boot a virtual device. Pass a UUID for iOS simulator or an AVD name for Android emulator.",
    {
      target: z.string().describe("iOS simulator UDID or Android AVD name (e.g. 'Pixel_8')"),
      dnsServer: z.string().optional().describe("Android only: DNS server (e.g. '8.8.8.8')"),
      timeout: z.number().optional().default(90000).describe("Max ms to wait for boot"),
    },
    async ({ target, dnsServer, timeout }) => {
      // UUID format → iOS simulator
      const isIOS = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(target);

      if (isIOS) {
        const result = await iosSim.boot(target, { waitUntilReady: true, timeout });
        return {
          content: [{ type: "text", text: JSON.stringify({ platform: "ios", ...result }, null, 2) }],
          isError: !result.success,
        };
      }

      // Android AVD name
      const result = await androidDev.bootEmulator(target, { dnsServer });
      return {
        content: [{ type: "text", text: JSON.stringify({ platform: "android", ...result }, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: shutdown_device (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "shutdown_device",
    "Shutdown a virtual device. Auto-detects platform from device ID.",
    {
      deviceId: z.string().describe("Device ID (UUID for iOS, emulator-5554 for Android)"),
    },
    async ({ deviceId }) => {
      const platform = MaestroCli.detectPlatform(deviceId);
      const result = platform === "ios"
        ? await iosSim.shutdown(deviceId)
        : await androidDev.shutdownEmulator(deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: open_url (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "open_url",
    "Open a URL (deep link, universal link, intent) on a device. Auto-detects platform from deviceId.",
    {
      deviceId: z.string().describe("Device ID (emulator-5554 for Android, UUID for iOS)"),
      url: z.string().describe("URL to open (e.g. myapp://path, https://example.com/deep)"),
    },
    async ({ deviceId, url }) => {
      const platform = MaestroCli.detectPlatform(deviceId);
      const result = platform === "ios"
        ? await iosSim.openUrl(deviceId, url)
        : await androidDev.openUrl(url, deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: set_permissions (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "set_permissions",
    "Grant, revoke, or reset permissions for an app. Auto-detects platform. Services: camera, location, location-always, microphone, contacts, calendar, photos, media-library, reminders, siri. iOS also supports: all, contacts-limited, photos-add, motion. iOS supports 'reset', Android only grant/revoke.",
    {
      deviceId: z.string().describe("Device ID"),
      action: z.enum(["grant", "revoke", "reset"]).describe("Permission action (reset: iOS only)"),
      service: z.enum([
        "all", "calendar", "contacts-limited", "contacts", "location",
        "location-always", "photos-add", "photos", "media-library",
        "microphone", "motion", "reminders", "siri", "camera",
      ]).describe("Privacy service"),
      appId: z.string().describe("App package/bundle ID"),
    },
    async ({ deviceId, action, service, appId }) => {
      const platform = MaestroCli.detectPlatform(deviceId);

      if (platform === "ios") {
        const result = await iosSim.setPermission(deviceId, action, service, appId);
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
          isError: !result.success,
        };
      }

      // Android
      if (action === "reset") {
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, success: false, error: "Android does not support 'reset'. Use 'revoke' then 'grant'." }) }],
          isError: true,
        };
      }
      const androidPerm = ANDROID_PERMISSIONS[service];
      if (!androidPerm) {
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, success: false, error: `No Android equivalent for service '${service}'` }) }],
          isError: true,
        };
      }
      const result = await androidDev.setPermission(action, androidPerm, appId, deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, permission: androidPerm, ...result }) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: send_push (iOS only — Android requires FCM server key)
  // ────────────────────────────────────────────
  server.tool(
    "send_push",
    "Send a simulated push notification. Currently iOS simulator only (Android requires FCM server key).",
    {
      deviceId: z.string().describe("iOS simulator UDID"),
      appId: z.string().describe("App bundle ID"),
      title: z.string().optional().describe("Notification title"),
      body: z.string().optional().describe("Notification body"),
      badge: z.number().optional().describe("Badge count"),
      sound: z.string().optional().default("default").describe("Sound name"),
      customData: z.record(z.string(), z.unknown()).optional().describe("Extra payload fields"),
    },
    async ({ deviceId, appId, title, body, badge, sound, customData }) => {
      const platform = MaestroCli.detectPlatform(deviceId);
      if (platform !== "ios") {
        return {
          content: [{ type: "text", text: "Push simulation only supported on iOS simulator. Android requires FCM server key." }],
          isError: true,
        };
      }

      const alert: Record<string, string> = {};
      if (title) alert.title = title;
      if (body) alert.body = body;

      const payload = {
        aps: {
          ...(Object.keys(alert).length > 0 ? { alert } : {}),
          ...(badge !== undefined ? { badge } : {}),
          ...(sound ? { sound } : {}),
        },
        ...customData,
      };

      const result = await iosSim.sendPush(deviceId, appId, payload);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: override_status_bar (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "override_status_bar",
    "Override status bar for clean screenshots. Works on both iOS (simctl status_bar) and Android (demo mode). Use clear=true to reset.",
    {
      deviceId: z.string().describe("Device ID"),
      clear: z.boolean().optional().describe("Clear all overrides"),
      time: z.string().optional().describe("Time string (e.g. '9:41')"),
      batteryLevel: z.number().min(0).max(100).optional(),
      wifiBars: z.number().min(0).max(3).optional(),
      cellularBars: z.number().min(0).max(4).optional(),
      // iOS-specific
      dataNetwork: z.enum(["wifi", "3g", "4g", "lte", "lte-a", "lte+", "5g", "5g+", "5g-uwb"]).optional().describe("iOS only"),
      wifiMode: z.enum(["searching", "failed", "active"]).optional().describe("iOS only"),
      cellularMode: z.enum(["notSupported", "searching", "failed", "active"]).optional().describe("iOS only"),
      batteryState: z.enum(["charging", "charged", "discharging"]).optional().describe("iOS only"),
      operatorName: z.string().optional().describe("Carrier name"),
    },
    async ({ deviceId, clear, time, batteryLevel, wifiBars, cellularBars, dataNetwork, wifiMode, cellularMode, batteryState, operatorName }) => {
      const platform = MaestroCli.detectPlatform(deviceId);

      if (clear) {
        const result = platform === "ios"
          ? await iosSim.clearStatusBar(deviceId)
          : await androidDev.clearStatusBar(deviceId);
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
          isError: !result.success,
        };
      }

      if (platform === "ios") {
        const result = await iosSim.overrideStatusBar(deviceId, {
          time,
          dataNetwork,
          wifiMode,
          wifiBars: wifiBars as 0 | 1 | 2 | 3 | undefined,
          cellularMode,
          cellularBars: cellularBars as 0 | 1 | 2 | 3 | 4 | undefined,
          batteryState,
          batteryLevel,
          operatorName,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
          isError: !result.success,
        };
      }

      // Android demo mode
      const result = await androidDev.overrideStatusBar({
        time,
        wifi: wifiBars !== undefined ? wifiBars > 0 : undefined,
        wifiLevel: wifiBars,
        mobile: cellularBars !== undefined ? cellularBars > 0 : undefined,
        mobileLevel: cellularBars,
        batteryLevel,
        batteryCharging: batteryState === "charging",
        notifications: false,
      }, deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: set_location (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "set_location",
    "Set simulated GPS location on a device. Works on iOS simulator (simctl) and Android emulator (geo fix). Use clear=true to reset (iOS only).",
    {
      deviceId: z.string().describe("Device ID"),
      latitude: z.number().optional().describe("Latitude (e.g. 37.7749)"),
      longitude: z.number().optional().describe("Longitude (e.g. -122.4194)"),
      clear: z.boolean().optional().describe("Clear location override (iOS only)"),
    },
    async ({ deviceId, latitude, longitude, clear }) => {
      const platform = MaestroCli.detectPlatform(deviceId);

      if (clear) {
        if (platform === "ios") {
          const result = await iosSim.clearLocation(deviceId);
          return {
            content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
            isError: !result.success,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, success: true, message: "Android: set a different location or restart emulator to clear." }) }],
        };
      }

      if (latitude === undefined || longitude === undefined) {
        return {
          content: [{ type: "text", text: "latitude and longitude required when not clearing" }],
          isError: true,
        };
      }

      const result = platform === "ios"
        ? await iosSim.setLocation(deviceId, latitude, longitude)
        : await androidDev.setLocation(latitude, longitude, deviceId);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: create_device (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "create_device",
    "Create a new virtual device. iOS: provide deviceType + runtime identifiers. Android: provide systemImage package path + optional device profile. Use list_virtual_devices to discover available options.",
    {
      platform: z.enum(["ios", "android"]).describe("Target platform"),
      name: z.string().describe("Device name (e.g. 'Test iPhone' or 'Pixel_9_Test')"),
      // iOS params
      deviceType: z.string().optional().describe("iOS: device type (e.g. 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro')"),
      runtime: z.string().optional().describe("iOS: runtime (e.g. 'com.apple.CoreSimulator.SimRuntime.iOS-26-0')"),
      // Android params
      systemImage: z.string().optional().describe("Android: system image package (e.g. 'system-images;android-35;google_apis;arm64-v8a')"),
      device: z.string().optional().describe("Android: device profile (e.g. 'pixel_8', 'medium_phone'). Use list_virtual_devices to see options."),
    },
    async ({ platform, name, deviceType, runtime, systemImage, device }) => {
      if (platform === "ios") {
        if (!deviceType || !runtime) {
          return {
            content: [{ type: "text", text: "iOS requires deviceType and runtime parameters." }],
            isError: true,
          };
        }
        const result = await iosSim.createSimulator(name, deviceType, runtime);
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, ...result }, null, 2) }],
          isError: !result.success,
        };
      }

      // Android
      if (!systemImage) {
        return {
          content: [{ type: "text", text: "Android requires systemImage parameter (e.g. 'system-images;android-35;google_apis;arm64-v8a')." }],
          isError: true,
        };
      }
      const result = await androidDev.createEmulator(name, systemImage, device);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: delete_device (cross-platform)
  // ────────────────────────────────────────────
  server.tool(
    "delete_device",
    "Delete a virtual device. iOS: pass simulator UDID. Android: pass AVD name.",
    {
      platform: z.enum(["ios", "android"]).describe("Target platform"),
      target: z.string().describe("iOS: simulator UDID. Android: AVD name."),
    },
    async ({ platform, target }) => {
      if (platform === "ios") {
        const result = await iosSim.deleteSimulator(target);
        return {
          content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
          isError: !result.success,
        };
      }

      const result = await androidDev.deleteEmulator(target);
      return {
        content: [{ type: "text", text: JSON.stringify({ platform, ...result }) }],
        isError: !result.success,
      };
    }
  );

  // ────────────────────────────────────────────
  // TOOL: scan_project
  // ────────────────────────────────────────────
  server.tool(
    "scan_project",
    "Scan a mobile project directory to discover screens, UI elements, and navigation structure. Analyzes Swift (SwiftUI/UIKit), Kotlin (Compose/XML), and React Native projects. Returns discovered screens with their UI elements (buttons, text fields, labels, etc.) and navigation targets.",
    {
      projectPath: z.string().describe("Absolute path to the mobile project root"),
      maxFiles: z.number().optional().default(100).describe("Max source files to analyze"),
    },
    async ({ projectPath, maxFiles }) => {
      try {
        const result = await scanProject(projectPath, { maxFiles });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: unknown) {
        const error = err as { message?: string };
        return {
          content: [{ type: "text", text: `Scan failed: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: analyze_source_file
  // ────────────────────────────────────────────
  server.tool(
    "analyze_source_file",
    "Read and analyze a single native source file (.swift, .kt, .java, .xml layout). Extracts screens, UI elements (buttons, text fields, labels with their text/IDs), navigation targets, and returns the raw source code for deeper analysis.",
    {
      filePath: z.string().describe("Absolute path to the source file"),
    },
    async ({ filePath }) => {
      try {
        const result = await analyzeFile(filePath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                screens: result.screens,
                lineCount: result.content.split("\n").length,
              }, null, 2),
            },
            {
              type: "text",
              text: `--- Source: ${filePath} ---\n${result.content}`,
            },
          ],
        };
      } catch (err: unknown) {
        const error = err as { message?: string };
        return {
          content: [{ type: "text", text: `Analysis failed: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: suggest_flows
  // ────────────────────────────────────────────
  server.tool(
    "suggest_flows",
    "Scan a project and suggest Maestro test flows based on discovered screens and UI elements. Returns suggested flow configs with steps ready to pass to generate_and_run_flow.",
    {
      projectPath: z.string().describe("Absolute path to the mobile project root"),
      maxFiles: z.number().optional().default(100),
    },
    async ({ projectPath, maxFiles }) => {
      try {
        const scan = await scanProject(projectPath, { maxFiles });

        const suggestions: Array<{
          name: string;
          description: string;
          screens: string[];
          steps: Array<{ action: string; params: Record<string, unknown> }>;
        }> = [];

        // Find login screens
        const loginScreens = scan.screens.filter((s) => {
          const hasEmail = s.elements.some((e) =>
            e.text?.toLowerCase().includes("email") ||
            e.text?.toLowerCase().includes("username") ||
            e.text?.toLowerCase().includes("correo")
          );
          const hasPassword = s.elements.some((e) =>
            e.text?.toLowerCase().includes("password") ||
            e.text?.toLowerCase().includes("contraseña")
          );
          return hasEmail && hasPassword;
        });

        for (const screen of loginScreens) {
          const emailField = screen.elements.find((e) =>
            e.kind === "textField" &&
            (e.text?.toLowerCase().includes("email") || e.text?.toLowerCase().includes("correo"))
          );
          const passField = screen.elements.find((e) =>
            e.kind === "textField" &&
            (e.text?.toLowerCase().includes("password") || e.text?.toLowerCase().includes("contraseña"))
          );
          const loginBtn = screen.elements.find((e) =>
            e.kind === "button" &&
            (e.text?.toLowerCase().includes("sign in") ||
              e.text?.toLowerCase().includes("log in") ||
              e.text?.toLowerCase().includes("iniciar"))
          );

          suggestions.push({
            name: `login-${screen.name}`,
            description: `Login flow for ${screen.name}`,
            screens: [screen.name],
            steps: [
              { action: "launchApp", params: {} },
              { action: "waitForAnimationToEnd", params: {} },
              ...(emailField
                ? [
                    { action: "tapOn", params: { text: emailField.text } },
                    { action: "inputText", params: { text: "test@example.com" } },
                  ]
                : []),
              ...(passField
                ? [
                    { action: "tapOn", params: { text: passField.text } },
                    { action: "inputText", params: { text: "password123" } },
                  ]
                : []),
              { action: "hideKeyboard", params: {} },
              ...(loginBtn
                ? [{ action: "tapOn", params: { text: loginBtn.text } }]
                : []),
              { action: "waitForAnimationToEnd", params: {} },
              { action: "takeScreenshot", params: {} },
            ],
          });
        }

        // Find screens with navigation
        const navScreens = scan.screens.filter((s) => s.navigationTargets.length > 0);
        if (navScreens.length > 0) {
          const navSteps: Array<{ action: string; params: Record<string, unknown> }> = [
            { action: "launchApp", params: {} },
            { action: "waitForAnimationToEnd", params: {} },
          ];

          for (const screen of navScreens.slice(0, 5)) {
            const trigger = screen.elements.find((e) => e.isNavigationTrigger || e.kind === "button");
            if (trigger?.text) {
              navSteps.push(
                { action: "tapOn", params: { text: trigger.text } },
                { action: "waitForAnimationToEnd", params: {} },
                { action: "takeScreenshot", params: {} }
              );
            }
          }

          suggestions.push({
            name: "navigation-test",
            description: "Navigate through discovered screens",
            screens: navScreens.map((s) => s.name),
            steps: navSteps,
          });
        }

        // Find screens with forms
        const formScreens = scan.screens.filter((s) => {
          const textFields = s.elements.filter((e) => e.kind === "textField");
          return textFields.length >= 2;
        });

        for (const screen of formScreens.filter((s) => !loginScreens.includes(s))) {
          const fields = screen.elements.filter((e) => e.kind === "textField");
          const submitBtn = screen.elements.find((e) => e.kind === "button");

          suggestions.push({
            name: `form-${screen.name}`,
            description: `Form fill test for ${screen.name} (${fields.length} fields)`,
            screens: [screen.name],
            steps: [
              { action: "launchApp", params: {} },
              { action: "waitForAnimationToEnd", params: {} },
              ...fields.flatMap((f) => [
                { action: "tapOn", params: { text: f.text ?? f.accessibilityId ?? f.resourceId } },
                { action: "inputText", params: { text: `test_${f.text ?? "value"}` } },
              ]),
              { action: "hideKeyboard", params: {} },
              ...(submitBtn?.text
                ? [{ action: "tapOn", params: { text: submitBtn.text } }]
                : []),
              { action: "waitForAnimationToEnd", params: {} },
              { action: "takeScreenshot", params: {} },
            ],
          });
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              projectPath: scan.projectPath,
              platform: scan.platform,
              appId: scan.appId,
              totalScreens: scan.screens.length,
              suggestions,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const error = err as { message?: string };
        return {
          content: [{ type: "text", text: `Suggest failed: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // ────────────────────────────────────────────
  // TOOL: clean_flows
  // ────────────────────────────────────────────
  server.tool(
    "clean_flows",
    "Delete all temporary generated flow files",
    {},
    async () => {
      const count = await cleanTempFlows();
      return {
        content: [{ type: "text", text: `Cleaned ${count} temporary flow(s)` }],
      };
    }
  );

  // ────────────────────────────────────────────
  // PLUGINS
  // ────────────────────────────────────────────
  const pluginContext: PluginContext = { maestro, iosSim, androidDev, server };
  const pluginResults = await loadPlugins(pluginContext);

  if (pluginResults.loaded.length > 0) {
    console.error(`Plugins loaded: ${pluginResults.loaded.join(", ")}`);
  }
  for (const err of pluginResults.errors) {
    console.error(`Plugin error [${err.name}]: ${err.error}`);
  }

  return { server, pluginResults };
}
