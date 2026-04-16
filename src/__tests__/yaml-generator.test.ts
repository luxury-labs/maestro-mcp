import { describe, it, expect } from "vitest";
import { generateYaml, adaptStepsForPlatform } from "../generators/yaml-generator.js";
import type { FlowStep, FlowConfig } from "../maestro/types.js";

describe("generateYaml", () => {
  it("generates basic flow YAML", () => {
    const config: FlowConfig = { appId: "com.test.app", name: "test-flow" };
    const steps: FlowStep[] = [
      { action: "launchApp", params: {} },
      { action: "tapOn", params: { text: "Sign In" } },
      { action: "inputText", params: { text: "hello" } },
    ];
    const yaml = generateYaml(config, steps);
    expect(yaml).toContain("appId: com.test.app");
    expect(yaml).toContain("name: test-flow");
    expect(yaml).toContain('- tapOn: "Sign In"');
    expect(yaml).toContain('- inputText: "hello"');
  });

  it("generates swipe with direction", () => {
    const yaml = generateYaml({ appId: "com.test" }, [
      { action: "swipe", params: { direction: "UP" } },
    ]);
    expect(yaml).toContain("direction: UP");
  });

  it("generates swipe with from/to", () => {
    const yaml = generateYaml({ appId: "com.test" }, [
      { action: "swipe", params: { from: "0%,50%", to: "80%,50%" } },
    ]);
    expect(yaml).toContain('from: "0%,50%"');
    expect(yaml).toContain('to: "80%,50%"');
  });
});

describe("adaptStepsForPlatform", () => {
  it("android: steps unchanged", () => {
    const steps: FlowStep[] = [
      { action: "back", params: {} },
      { action: "hideKeyboard", params: {} },
    ];
    const result = adaptStepsForPlatform(steps, "android");
    expect(result).toEqual(steps);
  });

  it("ios: back → swipe from left edge", () => {
    const steps: FlowStep[] = [{ action: "back", params: {} }];
    const result = adaptStepsForPlatform(steps, "ios");
    expect(result[0].action).toBe("swipe");
    expect(result[0].params.from).toBe("0%,50%");
    expect(result[0].params.to).toBe("80%,50%");
  });

  it("ios: hideKeyboard → tap neutral area", () => {
    const steps: FlowStep[] = [{ action: "hideKeyboard", params: {} }];
    const result = adaptStepsForPlatform(steps, "ios");
    expect(result[0].action).toBe("tapOn");
    expect(result[0].params.point).toBe("50%,10%");
  });

  it("ios: other steps pass through", () => {
    const steps: FlowStep[] = [
      { action: "tapOn", params: { text: "OK" } },
      { action: "inputText", params: { text: "hi" } },
    ];
    const result = adaptStepsForPlatform(steps, "ios");
    expect(result).toEqual(steps);
  });
});
