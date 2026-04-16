import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { FlowStep, FlowConfig, GeneratedFlow } from "../maestro/types.js";

const FLOWS_DIR = path.join(process.cwd(), ".maestro-mcp", "flows");

/** Maps FlowStep actions to Maestro YAML syntax */
function stepToYaml(step: FlowStep): string {
  const { action, params } = step;

  switch (action) {
    case "launchApp":
      return params.appId
        ? `- launchApp: ${params.appId}`
        : "- launchApp";

    case "stopApp":
      return params.appId
        ? `- stopApp: ${params.appId}`
        : "- stopApp";

    case "clearState":
      return params.appId
        ? `- clearState: ${params.appId}`
        : "- clearState";

    case "tapOn": {
      if (typeof params.text === "string") {
        return `- tapOn: "${params.text}"`;
      }
      const tapProps: string[] = [];
      if (params.id) tapProps.push(`    id: "${params.id}"`);
      if (params.text) tapProps.push(`    text: "${params.text}"`);
      if (params.index !== undefined) tapProps.push(`    index: ${params.index}`);
      if (params.point) tapProps.push(`    point: "${params.point}"`);
      if (params.longPress) tapProps.push(`    longPress: true`);
      if (params.retryTapIfNoChange !== undefined)
        tapProps.push(`    retryTapIfNoChange: ${params.retryTapIfNoChange}`);
      return `- tapOn:\n${tapProps.join("\n")}`;
    }

    case "inputText":
      return `- inputText: "${params.text}"`;

    case "eraseText":
      return `- eraseText: ${params.chars ?? 50}`;

    case "pasteText":
      return `- pasteText: "${params.text}"`;

    case "assertVisible":
      if (typeof params.text === "string") {
        return params.enabled !== undefined
          ? `- assertVisible:\n    text: "${params.text}"\n    enabled: ${params.enabled}`
          : `- assertVisible: "${params.text}"`;
      }
      if (params.id) return `- assertVisible:\n    id: "${params.id}"`;
      return `- assertVisible: "${params.text ?? params.id}"`;

    case "assertNotVisible":
      return typeof params.text === "string"
        ? `- assertNotVisible: "${params.text}"`
        : `- assertNotVisible:\n    id: "${params.id}"`;

    case "waitUntilVisible":
      return typeof params.text === "string"
        ? `- extendedWaitUntil:\n    visible: "${params.text}"\n    timeout: ${params.timeout ?? 10000}`
        : `- extendedWaitUntil:\n    visible:\n      id: "${params.id}"\n    timeout: ${params.timeout ?? 10000}`;

    case "scrollUntilVisible": {
      const direction = params.direction ?? "DOWN";
      const element = params.text
        ? `"${params.text}"`
        : `\n      id: "${params.id}"`;
      return `- scrollUntilVisible:\n    element: ${element}\n    direction: ${direction}`;
    }

    case "scroll":
      return `- scroll`;

    case "swipe": {
      const dir = params.direction ?? "LEFT";
      if (params.from && params.to) {
        return `- swipe:\n    from: "${params.from}"\n    to: "${params.to}"`;
      }
      return `- swipe:\n    direction: ${dir}`;
    }

    case "back":
      return "- back";

    case "hideKeyboard":
      return "- hideKeyboard";

    case "waitForAnimationToEnd":
      return params.timeout
        ? `- waitForAnimationToEnd:\n    timeout: ${params.timeout}`
        : "- waitForAnimationToEnd";

    case "takeScreenshot":
      return `- takeScreenshot: ${params.name ?? `screenshot-${Date.now()}`}`;

    case "pressKey": {
      const key = params.key ?? "Enter";
      return `- pressKey: ${key}`;
    }

    case "openLink":
      return `- openLink: ${params.url}`;

    case "clearKeychain":
      return "- clearKeychain";

    case "setLocation":
      return `- setLocation:\n    latitude: ${params.latitude}\n    longitude: ${params.longitude}`;

    case "repeat": {
      const times = params.times ?? 1;
      const innerSteps = (params.steps as FlowStep[])
        .map((s) => stepToYaml(s))
        .map((line) => `    ${line.replace(/^- /, "")}`)
        .join("\n");
      return `- repeat:\n    times: ${times}\n    commands:\n${innerSteps}`;
    }

    case "evalScript":
      return `- evalScript: |\n    ${(params.script as string).split("\n").join("\n    ")}`;

    case "runFlow":
      return `- runFlow: ${params.path}`;

    default:
      return `# Unknown action: ${action}`;
  }
}

/** Generate Maestro YAML from flow config and steps */
export function generateYaml(config: FlowConfig, steps: FlowStep[]): string {
  const headerLines: string[] = [];
  headerLines.push(`appId: ${config.appId}`);

  if (config.name) headerLines.push(`name: ${config.name}`);

  if (config.tags?.length) {
    headerLines.push("tags:");
    for (const tag of config.tags) {
      headerLines.push(`  - ${tag}`);
    }
  }

  if (config.env && Object.keys(config.env).length) {
    headerLines.push("env:");
    for (const [key, value] of Object.entries(config.env)) {
      headerLines.push(`  ${key}: "${value}"`);
    }
  }

  const header = headerLines.join("\n");
  const body = steps.map(stepToYaml).join("\n");

  return `${header}\n---\n${body}\n`;
}

/** Create a temporary flow file, return its metadata */
export async function createTempFlow(
  config: FlowConfig,
  steps: FlowStep[]
): Promise<GeneratedFlow> {
  await fs.mkdir(FLOWS_DIR, { recursive: true });

  const flowId = uuidv4().slice(0, 8);
  const flowName = config.name ?? `flow-${flowId}`;
  const flowPath = path.join(FLOWS_DIR, `${flowName}.yaml`);
  const yaml = generateYaml(config, steps);

  await fs.writeFile(flowPath, yaml, "utf-8");

  return {
    path: flowPath,
    yaml,
    config,
    steps,
    isTemporary: true,
  };
}

/** Delete a temporary flow file */
export async function deleteTempFlow(flowPath: string): Promise<void> {
  try {
    await fs.unlink(flowPath);
  } catch {
    // File may already be deleted
  }
}

/** Clean all temporary flows */
export async function cleanTempFlows(): Promise<number> {
  try {
    const files = await fs.readdir(FLOWS_DIR);
    let count = 0;
    for (const file of files) {
      if (file.endsWith(".yaml")) {
        await fs.unlink(path.join(FLOWS_DIR, file));
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Adapt flow steps for a target platform.
 * Maestro YAML is mostly platform-agnostic, but some actions need adjustment:
 * - `back` doesn't exist on iOS → swipe from left edge (edge gesture)
 * - `hideKeyboard` → tap outside text field on iOS (more reliable)
 * - `pressKey: "Enter"` works on both, but key names may differ
 */
export function adaptStepsForPlatform(
  steps: FlowStep[],
  platform: "android" | "ios"
): FlowStep[] {
  if (platform === "android") return steps;

  return steps.map((step) => {
    switch (step.action) {
      case "back":
        // iOS has no back button — swipe from left edge
        return {
          action: "swipe" as const,
          params: { from: "0%,50%", to: "80%,50%" },
        };

      case "hideKeyboard":
        // iOS: tap on a neutral area above the keyboard
        return {
          action: "tapOn" as const,
          params: { point: "50%,10%" },
        };

      default:
        return step;
    }
  });
}

/** Generate a complete login test flow */
export function generateLoginFlow(
  appId: string,
  opts: {
    usernameField?: string;
    passwordField?: string;
    username: string;
    password: string;
    loginButton?: string;
    expectedAfterLogin?: string;
  }
): { config: FlowConfig; steps: FlowStep[] } {
  const steps: FlowStep[] = [
    { action: "launchApp", params: { appId } },
    { action: "waitForAnimationToEnd", params: {} },
    {
      action: "tapOn",
      params: { id: opts.usernameField, text: opts.usernameField ? undefined : "Username" },
    },
    { action: "inputText", params: { text: opts.username } },
    {
      action: "tapOn",
      params: { id: opts.passwordField, text: opts.passwordField ? undefined : "Password" },
    },
    { action: "inputText", params: { text: opts.password } },
    { action: "hideKeyboard", params: {} },
    {
      action: "tapOn",
      params: { text: opts.loginButton ?? "Log in" },
    },
    { action: "waitForAnimationToEnd", params: {} },
  ];

  if (opts.expectedAfterLogin) {
    steps.push({
      action: "assertVisible",
      params: { text: opts.expectedAfterLogin },
    });
  }

  steps.push({ action: "takeScreenshot", params: { name: "after-login" } });

  return {
    config: { appId, name: "login-test", tags: ["auth", "auto-generated"] },
    steps,
  };
}

/** Generate a navigation test — opens app and navigates through screens */
export function generateNavigationFlow(
  appId: string,
  screens: { name: string; tapTarget: string; assertVisible: string }[]
): { config: FlowConfig; steps: FlowStep[] } {
  const steps: FlowStep[] = [
    { action: "launchApp", params: { appId } },
    { action: "waitForAnimationToEnd", params: {} },
  ];

  for (const screen of screens) {
    steps.push(
      { action: "tapOn", params: { text: screen.tapTarget } },
      { action: "waitForAnimationToEnd", params: {} },
      { action: "assertVisible", params: { text: screen.assertVisible } },
      { action: "takeScreenshot", params: { name: `nav-${screen.name}` } }
    );
  }

  return {
    config: { appId, name: "navigation-test", tags: ["navigation", "auto-generated"] },
    steps,
  };
}

/** Generate a scroll + search test */
export function generateScrollSearchFlow(
  appId: string,
  opts: {
    searchTerm: string;
    searchFieldId?: string;
    expectedResult: string;
  }
): { config: FlowConfig; steps: FlowStep[] } {
  const steps: FlowStep[] = [
    { action: "launchApp", params: { appId } },
    { action: "waitForAnimationToEnd", params: {} },
  ];

  if (opts.searchFieldId) {
    steps.push({ action: "tapOn", params: { id: opts.searchFieldId } });
  } else {
    steps.push({ action: "tapOn", params: { text: "Search" } });
  }

  steps.push(
    { action: "inputText", params: { text: opts.searchTerm } },
    { action: "pressKey", params: { key: "Enter" } },
    { action: "waitForAnimationToEnd", params: {} },
    { action: "scrollUntilVisible", params: { text: opts.expectedResult, direction: "DOWN" } },
    { action: "assertVisible", params: { text: opts.expectedResult } },
    { action: "takeScreenshot", params: { name: "search-result" } }
  );

  return {
    config: { appId, name: "search-test", tags: ["search", "auto-generated"] },
    steps,
  };
}

/** Generate a form fill test */
export function generateFormFlow(
  appId: string,
  fields: { label: string; value: string; id?: string }[],
  opts?: { submitButton?: string; expectedAfterSubmit?: string }
): { config: FlowConfig; steps: FlowStep[] } {
  const steps: FlowStep[] = [
    { action: "launchApp", params: { appId } },
    { action: "waitForAnimationToEnd", params: {} },
  ];

  for (const field of fields) {
    steps.push(
      { action: "tapOn", params: field.id ? { id: field.id } : { text: field.label } },
      { action: "inputText", params: { text: field.value } }
    );
  }

  steps.push({ action: "hideKeyboard", params: {} });

  if (opts?.submitButton) {
    steps.push({ action: "tapOn", params: { text: opts.submitButton } });
    steps.push({ action: "waitForAnimationToEnd", params: {} });
  }

  if (opts?.expectedAfterSubmit) {
    steps.push({ action: "assertVisible", params: { text: opts.expectedAfterSubmit } });
  }

  steps.push({ action: "takeScreenshot", params: { name: "form-submitted" } });

  return {
    config: { appId, name: "form-test", tags: ["form", "auto-generated"] },
    steps,
  };
}
