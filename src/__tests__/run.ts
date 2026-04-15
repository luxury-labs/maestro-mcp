import { createServer } from "../server.js";
import {
  generateYaml,
  createTempFlow,
  deleteTempFlow,
  cleanTempFlows,
  generateLoginFlow,
  generateNavigationFlow,
  generateScrollSearchFlow,
  generateFormFlow,
} from "../generators/yaml-generator.js";
import type { FlowStep, FlowConfig } from "../maestro/types.js";
import { MaestroCli } from "../maestro/cli.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// ─── Test: YAML Generation ───────────────────
console.log("\n▸ YAML Generation");

const config: FlowConfig = { appId: "com.test.app", name: "test-flow" };
const steps: FlowStep[] = [
  { action: "launchApp", params: { appId: "com.test.app" } },
  { action: "tapOn", params: { text: "Login" } },
  { action: "inputText", params: { text: "user@test.com" } },
  { action: "assertVisible", params: { text: "Welcome" } },
  { action: "swipe", params: { direction: "UP" } },
  { action: "back", params: {} },
  { action: "hideKeyboard", params: {} },
  { action: "takeScreenshot", params: { name: "test-ss" } },
  { action: "pressKey", params: { key: "Enter" } },
  { action: "waitForAnimationToEnd", params: {} },
  { action: "scrollUntilVisible", params: { text: "Bottom", direction: "DOWN" } },
  { action: "setLocation", params: { latitude: 37.7749, longitude: -122.4194 } },
];

const yaml = generateYaml(config, steps);
assert(yaml.includes("appId: com.test.app"), "YAML contains appId");
assert(yaml.includes("name: test-flow"), "YAML contains flow name");
assert(yaml.includes("---"), "YAML has separator");
assert(yaml.includes('- launchApp: com.test.app'), "launchApp step");
assert(yaml.includes('- tapOn: "Login"'), "tapOn step");
assert(yaml.includes('- inputText: "user@test.com"'), "inputText step");
assert(yaml.includes('- assertVisible: "Welcome"'), "assertVisible step");
assert(yaml.includes("direction: UP"), "swipe direction");
assert(yaml.includes("- back"), "back step");
assert(yaml.includes("- hideKeyboard"), "hideKeyboard step");
assert(yaml.includes("- takeScreenshot: test-ss"), "takeScreenshot step");
assert(yaml.includes("- pressKey: Enter"), "pressKey step");
assert(yaml.includes("- waitForAnimationToEnd"), "waitForAnimationToEnd step");
assert(yaml.includes('scrollUntilVisible'), "scrollUntilVisible step");
assert(yaml.includes("latitude: 37.7749"), "setLocation step");

// ─── Test: Temp Flow Create/Delete ───────────
console.log("\n▸ Temp Flow Lifecycle");

const tempFlow = await createTempFlow(config, steps);
assert(tempFlow.path.endsWith(".yaml"), "Temp flow has .yaml extension");
assert(tempFlow.yaml === yaml, "Temp flow YAML matches generated");
assert(tempFlow.isTemporary === true, "Flow marked as temporary");

// Check file exists
import fs from "node:fs/promises";
try {
  await fs.access(tempFlow.path);
  assert(true, "Temp flow file exists on disk");
} catch {
  assert(false, "Temp flow file exists on disk");
}

await deleteTempFlow(tempFlow.path);
try {
  await fs.access(tempFlow.path);
  assert(false, "Temp flow deleted after cleanup");
} catch {
  assert(true, "Temp flow deleted after cleanup");
}

// ─── Test: Template Generators ───────────────
console.log("\n▸ Template Generators");

const loginFlow = generateLoginFlow("com.test.app", {
  username: "admin",
  password: "secret123",
  loginButton: "Sign In",
  expectedAfterLogin: "Dashboard",
});
assert(loginFlow.steps.length > 5, `Login flow has ${loginFlow.steps.length} steps`);
assert(loginFlow.config.tags?.includes("auth") ?? false, "Login flow tagged 'auth'");

const navFlow = generateNavigationFlow("com.test.app", [
  { name: "home", tapTarget: "Home", assertVisible: "Home Screen" },
  { name: "settings", tapTarget: "Settings", assertVisible: "Settings Screen" },
]);
assert(navFlow.steps.length > 4, `Navigation flow has ${navFlow.steps.length} steps`);
assert(navFlow.config.tags?.includes("navigation") ?? false, "Nav flow tagged 'navigation'");

const searchFlow = generateScrollSearchFlow("com.test.app", {
  searchTerm: "iPhone",
  expectedResult: "iPhone 15",
});
assert(searchFlow.steps.length > 4, `Search flow has ${searchFlow.steps.length} steps`);

const formFlow = generateFormFlow(
  "com.test.app",
  [
    { label: "Name", value: "John" },
    { label: "Email", value: "john@test.com" },
  ],
  { submitButton: "Submit", expectedAfterSubmit: "Success" }
);
assert(formFlow.steps.length > 5, `Form flow has ${formFlow.steps.length} steps`);

// ─── Test: Generated YAML from templates ─────
console.log("\n▸ Template YAML Output");

const loginYaml = generateYaml(loginFlow.config, loginFlow.steps);
assert(loginYaml.includes("launchApp"), "Login YAML has launchApp");
assert(loginYaml.includes('"admin"'), "Login YAML has username");
assert(loginYaml.includes('"Sign In"'), "Login YAML has login button");
assert(loginYaml.includes('"Dashboard"'), "Login YAML asserts dashboard");

// ─── Test: MCP Server creation ───────────────
console.log("\n▸ MCP Server");

const server = createServer();
assert(server !== null, "Server created successfully");

// ─── Test: Maestro CLI instance ──────────────
console.log("\n▸ Maestro CLI");

const cli = new MaestroCli();
const installed = await cli.isInstalled();
console.log(`  ℹ Maestro installed: ${installed}`);
// Not asserting installation — may not be installed in CI

// ─── Test: Clean flows ───────────────────────
console.log("\n▸ Cleanup");

// Create a few temp flows then clean
await createTempFlow({ appId: "com.test.cleanup1" }, [{ action: "back", params: {} }]);
await createTempFlow({ appId: "com.test.cleanup2" }, [{ action: "back", params: {} }]);
const cleaned = await cleanTempFlows();
assert(cleaned >= 2, `Cleaned ${cleaned} temp flows`);

// ─── Summary ─────────────────────────────────
console.log(`\n${"═".repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
