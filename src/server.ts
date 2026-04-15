import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MaestroCli } from "./maestro/cli.js";
import {
  generateYaml,
  createTempFlow,
  deleteTempFlow,
  cleanTempFlows,
  generateLoginFlow,
  generateNavigationFlow,
  generateScrollSearchFlow,
  generateFormFlow,
} from "./generators/yaml-generator.js";
import { ensureDirs } from "./utils/temp-files.js";
import type { FlowStep, FlowConfig } from "./maestro/types.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "maestro-mcp",
    version: "0.1.0",
  });

  const maestro = new MaestroCli();

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
    "Take a screenshot of the current device screen. Returns base64 PNG image.",
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
              mimeType: "image/png",
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
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result, yaml: flow.yaml }) }],
          isError: !result.success,
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
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: !result.success,
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
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: !result.success,
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
        return {
          content: [
            {
              type: "text",
              text: result.success
                ? `✓ Element visible: ${text ?? id}`
                : `✗ Element NOT visible: ${text ?? id}\n${result.errors.join("\n")}`,
            },
          ],
          isError: !result.success,
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
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: !result.success,
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
    "Press the back button (Android) or navigate back",
    {
      appId: z.string().describe("App package/bundle ID"),
      deviceId: z.string().optional(),
    },
    async ({ appId, deviceId }) => {
      const steps: FlowStep[] = [{ action: "back", params: {} }];
      const flow = await createTempFlow({ appId }, steps);
      try {
        const result = await maestro.runFlow(flow.path, { deviceId });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: !result.success,
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
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
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
      const flow = await createTempFlow(config, steps as FlowStep[]);

      try {
        const result = await maestro.runFlow(flow.path, { deviceId, env: envRecord });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...result,
                  generatedYaml: flow.yaml,
                  flowName: name ?? "unnamed",
                },
                null,
                2
              ),
            },
          ],
          isError: !result.success,
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  template,
                  ...result,
                  generatedYaml: flow.yaml,
                },
                null,
                2
              ),
            },
          ],
          isError: !result.success,
        };
      } finally {
        await deleteTempFlow(flow.path);
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

  return server;
}
