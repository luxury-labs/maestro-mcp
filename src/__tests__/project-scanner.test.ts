import { describe, it, expect } from "vitest";
import { scanProject, analyzeFile } from "../analyzers/project-scanner.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TMP = path.join(os.tmpdir(), "maestro-mcp-scanner-tests");

async function createProject(
  structure: Record<string, string>
): Promise<string> {
  const dir = path.join(TMP, `proj-${Date.now()}`);
  for (const [filePath, content] of Object.entries(structure)) {
    const full = path.join(dir, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return dir;
}

describe("scanProject — platform detection", () => {
  it("detects React Native", async () => {
    const dir = await createProject({
      "metro.config.js": "module.exports = {};",
      "app.json": JSON.stringify({
        expo: { android: { package: "com.test.rn" } },
      }),
    });
    const result = await scanProject(dir);
    expect(result.platform).toBe("react-native");
    expect(result.appId).toBe("com.test.rn");
  });

  it("detects Android (Gradle)", async () => {
    const dir = await createProject({
      "build.gradle.kts": 'plugins { id("com.android.application") }',
      "settings.gradle.kts": "",
    });
    const result = await scanProject(dir);
    expect(result.platform).toBe("android");
  });

  it("detects iOS (Xcode)", async () => {
    const dir = await createProject({
      "MyApp.xcodeproj/project.pbxproj": "",
    });
    const result = await scanProject(dir);
    expect(result.platform).toBe("ios");
  });

  it("detects Flutter", async () => {
    const dir = await createProject({
      "pubspec.yaml": "name: my_app",
    });
    const result = await scanProject(dir);
    expect(result.platform).toBe("flutter");
  });

  it("returns unknown for empty dir", async () => {
    const dir = await createProject({ "README.md": "hello" });
    const result = await scanProject(dir);
    expect(result.platform).toBe("unknown");
  });
});

describe("scanProject — screen discovery", () => {
  it("finds SwiftUI views in iOS project", async () => {
    const dir = await createProject({
      "MyApp.xcodeproj/project.pbxproj": "",
      "Sources/LoginView.swift": `
import SwiftUI
struct LoginView: View {
    var body: some View {
        TextField("Email", text: $email)
        Button("Sign In") { }
    }
}
`,
    });
    const result = await scanProject(dir);
    expect(result.platform).toBe("ios");
    expect(result.screens.length).toBeGreaterThanOrEqual(1);
    expect(result.screens[0].name).toBe("LoginView");
  });

  it("finds Composables in Android project", async () => {
    const dir = await createProject({
      "build.gradle.kts": "",
      "app/src/main/java/com/test/LoginScreen.kt": `
import androidx.compose.runtime.*
@Composable
fun LoginScreen() {
    OutlinedTextField(value = email, label = { Text("Email") })
    Button(onClick = {}) { Text("Login") }
}
`,
    });
    const result = await scanProject(dir);
    expect(result.platform).toBe("android");
    expect(result.frameworks).toContain("jetpack-compose");
    expect(result.screens.some((s) => s.name === "LoginScreen")).toBe(true);
  });
});

describe("scanProject — source file counts", () => {
  it("counts Swift and Kotlin files", async () => {
    const dir = await createProject({
      "MyApp.xcodeproj/project.pbxproj": "",
      "a.swift": "import SwiftUI",
      "b.swift": "import UIKit",
      "c.kt": "@Composable fun X() {}",
    });
    const result = await scanProject(dir);
    expect(result.sourceFiles.swift).toBe(2);
    expect(result.sourceFiles.kotlin).toBe(1);
  });
});

describe("analyzeFile", () => {
  it("analyzes a Swift file", async () => {
    const dir = await createProject({
      "Home.swift": `
import SwiftUI
struct HomeView: View {
    var body: some View {
        Text("Dashboard")
        Toggle("Dark Mode", isOn: $dark)
    }
}
`,
    });
    const result = await analyzeFile(path.join(dir, "Home.swift"));
    expect(result.screens).toHaveLength(1);
    expect(result.screens[0].name).toBe("HomeView");
    expect(result.content).toContain("Dashboard");
  });

  it("analyzes a Kotlin file", async () => {
    const dir = await createProject({
      "Settings.kt": `
@Composable
fun SettingsScreen() {
    LazyColumn {
        item { Text("Notifications") }
    }
}
`,
    });
    const result = await analyzeFile(path.join(dir, "Settings.kt"));
    expect(result.screens).toHaveLength(1);
    expect(result.screens[0].name).toBe("SettingsScreen");
  });

  it("analyzes a layout XML", async () => {
    const dir = await createProject({
      "res/layout/activity_main.xml": `
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">
    <EditText android:id="@+id/input" android:hint="Search" />
    <Button android:id="@+id/btn" android:text="Go" />
</LinearLayout>
`,
    });
    const result = await analyzeFile(path.join(dir, "res/layout/activity_main.xml"));
    expect(result.screens).toHaveLength(1);
    expect(result.screens[0].elements.some((e) => e.kind === "button")).toBe(true);
    expect(result.screens[0].elements.some((e) => e.kind === "textField")).toBe(true);
  });
});
