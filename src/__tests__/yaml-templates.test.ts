import { describe, it, expect } from "vitest";
import {
  generateYaml,
  generateLoginFlow,
  generateNavigationFlow,
  generateScrollSearchFlow,
  generateFormFlow,
} from "../generators/yaml-generator.js";

describe("generateLoginFlow", () => {
  it("generates login steps with defaults", () => {
    const { config, steps } = generateLoginFlow("com.test.app", {
      username: "user@test.com",
      password: "pass123",
    });
    expect(config.appId).toBe("com.test.app");
    expect(config.name).toBe("login-test");
    expect(steps.some((s) => s.action === "launchApp")).toBe(true);
    expect(steps.some((s) => s.action === "inputText" && s.params.text === "user@test.com")).toBe(true);
    expect(steps.some((s) => s.action === "inputText" && s.params.text === "pass123")).toBe(true);
    expect(steps.some((s) => s.action === "hideKeyboard")).toBe(true);
  });

  it("uses custom field IDs", () => {
    const { steps } = generateLoginFlow("com.test.app", {
      username: "user",
      password: "pass",
      usernameField: "email_input",
      passwordField: "pass_input",
      loginButton: "Login",
    });
    expect(steps.some((s) => s.params.id === "email_input")).toBe(true);
    expect(steps.some((s) => s.params.id === "pass_input")).toBe(true);
    expect(steps.some((s) => s.params.text === "Login")).toBe(true);
  });

  it("adds assertion when expectedAfterLogin set", () => {
    const { steps } = generateLoginFlow("com.test.app", {
      username: "user",
      password: "pass",
      expectedAfterLogin: "Dashboard",
    });
    expect(steps.some((s) => s.action === "assertVisible" && s.params.text === "Dashboard")).toBe(true);
  });

  it("generates valid YAML", () => {
    const { config, steps } = generateLoginFlow("com.test.app", {
      username: "user",
      password: "pass",
    });
    const yaml = generateYaml(config, steps);
    expect(yaml).toContain("appId: com.test.app");
    expect(yaml).toContain("name: login-test");
  });
});

describe("generateNavigationFlow", () => {
  it("generates navigation through screens", () => {
    const screens = [
      { name: "home", tapTarget: "Home", assertVisible: "Welcome" },
      { name: "settings", tapTarget: "Settings", assertVisible: "Preferences" },
    ];
    const { config, steps } = generateNavigationFlow("com.test.app", screens);
    expect(config.name).toBe("navigation-test");
    expect(steps.filter((s) => s.action === "tapOn")).toHaveLength(2);
    expect(steps.filter((s) => s.action === "assertVisible")).toHaveLength(2);
    expect(steps.filter((s) => s.action === "takeScreenshot")).toHaveLength(2);
  });
});

describe("generateScrollSearchFlow", () => {
  it("generates search flow", () => {
    const { config, steps } = generateScrollSearchFlow("com.test.app", {
      searchTerm: "pizza",
      expectedResult: "Pizza Place",
    });
    expect(config.name).toBe("search-test");
    expect(steps.some((s) => s.action === "inputText" && s.params.text === "pizza")).toBe(true);
    expect(steps.some((s) => s.action === "scrollUntilVisible")).toBe(true);
    expect(steps.some((s) => s.action === "assertVisible" && s.params.text === "Pizza Place")).toBe(true);
  });

  it("uses custom search field ID", () => {
    const { steps } = generateScrollSearchFlow("com.test.app", {
      searchTerm: "test",
      searchFieldId: "search_box",
      expectedResult: "Result",
    });
    expect(steps.some((s) => s.params.id === "search_box")).toBe(true);
  });
});

describe("generateFormFlow", () => {
  it("generates form fill with fields", () => {
    const fields = [
      { label: "Name", value: "John" },
      { label: "Email", value: "john@test.com" },
    ];
    const { config, steps } = generateFormFlow("com.test.app", fields, {
      submitButton: "Submit",
      expectedAfterSubmit: "Success",
    });
    expect(config.name).toBe("form-test");
    expect(steps.filter((s) => s.action === "inputText")).toHaveLength(2);
    expect(steps.some((s) => s.params.text === "Submit")).toBe(true);
    expect(steps.some((s) => s.action === "assertVisible" && s.params.text === "Success")).toBe(true);
  });

  it("uses field IDs when provided", () => {
    const fields = [
      { label: "Name", value: "John", id: "name_input" },
    ];
    const { steps } = generateFormFlow("com.test.app", fields);
    expect(steps.some((s) => s.params.id === "name_input")).toBe(true);
  });
});
