import { describe, it, expect } from "vitest";
import { generateYaml } from "../generators/yaml-generator.js";
import type { FlowStep } from "../maestro/types.js";

/** Helper to generate YAML for a single step */
function yamlForStep(step: FlowStep): string {
  return generateYaml({ appId: "com.test" }, [step]);
}

describe("stepToYaml — all action types", () => {
  it("launchApp without appId", () => {
    expect(yamlForStep({ action: "launchApp", params: {} })).toContain("- launchApp");
  });

  it("launchApp with appId", () => {
    expect(yamlForStep({ action: "launchApp", params: { appId: "com.x" } })).toContain("- launchApp: com.x");
  });

  it("stopApp", () => {
    expect(yamlForStep({ action: "stopApp", params: { appId: "com.x" } })).toContain("- stopApp: com.x");
  });

  it("clearState", () => {
    expect(yamlForStep({ action: "clearState", params: { appId: "com.x" } })).toContain("- clearState: com.x");
  });

  it("tapOn with text", () => {
    expect(yamlForStep({ action: "tapOn", params: { text: "OK" } })).toContain('- tapOn: "OK"');
  });

  it("tapOn with id and longPress", () => {
    const yaml = yamlForStep({ action: "tapOn", params: { id: "btn_login", longPress: true } });
    expect(yaml).toContain('id: "btn_login"');
    expect(yaml).toContain("longPress: true");
  });

  it("tapOn with point", () => {
    const yaml = yamlForStep({ action: "tapOn", params: { point: "50%,50%" } });
    expect(yaml).toContain('point: "50%,50%"');
  });

  it("inputText", () => {
    expect(yamlForStep({ action: "inputText", params: { text: "hello" } })).toContain('- inputText: "hello"');
  });

  it("eraseText with default", () => {
    expect(yamlForStep({ action: "eraseText", params: {} })).toContain("- eraseText: 50");
  });

  it("eraseText with chars", () => {
    expect(yamlForStep({ action: "eraseText", params: { chars: 10 } })).toContain("- eraseText: 10");
  });

  it("pasteText", () => {
    expect(yamlForStep({ action: "pasteText", params: { text: "pasted" } })).toContain('- pasteText: "pasted"');
  });

  it("assertVisible with text", () => {
    expect(yamlForStep({ action: "assertVisible", params: { text: "Welcome" } })).toContain('- assertVisible: "Welcome"');
  });

  it("assertVisible with id", () => {
    const yaml = yamlForStep({ action: "assertVisible", params: { id: "title" } });
    expect(yaml).toContain('id: "title"');
  });

  it("assertNotVisible", () => {
    expect(yamlForStep({ action: "assertNotVisible", params: { text: "Error" } })).toContain('- assertNotVisible: "Error"');
  });

  it("waitUntilVisible", () => {
    const yaml = yamlForStep({ action: "waitUntilVisible", params: { text: "Done", timeout: 5000 } });
    expect(yaml).toContain('visible: "Done"');
    expect(yaml).toContain("timeout: 5000");
  });

  it("scrollUntilVisible", () => {
    const yaml = yamlForStep({ action: "scrollUntilVisible", params: { text: "Item", direction: "DOWN" } });
    expect(yaml).toContain('"Item"');
    expect(yaml).toContain("direction: DOWN");
  });

  it("scroll", () => {
    expect(yamlForStep({ action: "scroll", params: {} })).toContain("- scroll");
  });

  it("back", () => {
    expect(yamlForStep({ action: "back", params: {} })).toContain("- back");
  });

  it("hideKeyboard", () => {
    expect(yamlForStep({ action: "hideKeyboard", params: {} })).toContain("- hideKeyboard");
  });

  it("waitForAnimationToEnd with timeout", () => {
    const yaml = yamlForStep({ action: "waitForAnimationToEnd", params: { timeout: 5000 } });
    expect(yaml).toContain("timeout: 5000");
  });

  it("takeScreenshot", () => {
    const yaml = yamlForStep({ action: "takeScreenshot", params: { name: "my-shot" } });
    expect(yaml).toContain("- takeScreenshot: my-shot");
  });

  it("pressKey", () => {
    expect(yamlForStep({ action: "pressKey", params: { key: "Enter" } })).toContain("- pressKey: Enter");
  });

  it("openLink", () => {
    expect(yamlForStep({ action: "openLink", params: { url: "https://test.com" } })).toContain("- openLink: https://test.com");
  });

  it("clearKeychain", () => {
    expect(yamlForStep({ action: "clearKeychain", params: {} })).toContain("- clearKeychain");
  });

  it("setLocation", () => {
    const yaml = yamlForStep({ action: "setLocation", params: { latitude: 37.77, longitude: -122.41 } });
    expect(yaml).toContain("latitude: 37.77");
    expect(yaml).toContain("longitude: -122.41");
  });

  it("evalScript", () => {
    const yaml = yamlForStep({ action: "evalScript", params: { script: "console.log('hi')" } });
    expect(yaml).toContain("evalScript:");
    expect(yaml).toContain("console.log('hi')");
  });

  it("runFlow", () => {
    expect(yamlForStep({ action: "runFlow", params: { path: "other.yaml" } })).toContain("- runFlow: other.yaml");
  });

  it("repeat", () => {
    const yaml = yamlForStep({
      action: "repeat",
      params: {
        times: 3,
        steps: [{ action: "tapOn", params: { text: "Next" } }],
      },
    });
    expect(yaml).toContain("times: 3");
    expect(yaml).toContain("Next");
  });
});

describe("generateYaml — config options", () => {
  it("includes tags", () => {
    const yaml = generateYaml(
      { appId: "com.test", tags: ["smoke", "auth"] },
      []
    );
    expect(yaml).toContain("tags:");
    expect(yaml).toContain("- smoke");
    expect(yaml).toContain("- auth");
  });

  it("includes env", () => {
    const yaml = generateYaml(
      { appId: "com.test", env: { API_URL: "http://localhost" } },
      []
    );
    expect(yaml).toContain("env:");
    expect(yaml).toContain('API_URL: "http://localhost"');
  });
});
