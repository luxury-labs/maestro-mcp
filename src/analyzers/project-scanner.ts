import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectPlatform, UIFramework, ProjectScanResult, DiscoveredScreen } from "./types.js";
import { analyzeSwiftFile } from "./swift-analyzer.js";
import { analyzeKotlinFile, analyzeLayoutXml } from "./kotlin-analyzer.js";
import { buildStringMap } from "./string-resolver.js";
import { buildComponentRegistry } from "./component-registry.js";

/** Glob-like recursive file finder (no external deps) */
async function findFiles(
  dir: string,
  extensions: string[],
  maxDepth = 15,
  ignore = ["node_modules", ".build", "build", "Pods", ".gradle", "DerivedData", ".git"]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir, 0);
  return results;
}

/** Detect project platform from file presence */
async function detectPlatform(projectPath: string): Promise<{
  platform: ProjectPlatform;
  frameworks: UIFramework[];
}> {
  const entries = await fs.readdir(projectPath).catch(() => [] as string[]);
  const hasFile = (name: string) => entries.includes(name);

  // React Native
  if (hasFile("metro.config.js") || hasFile("app.json") || hasFile("index.js")) {
    const frameworks: UIFramework[] = ["react-native"];
    return { platform: "react-native", frameworks };
  }

  // Flutter
  if (hasFile("pubspec.yaml")) {
    return { platform: "flutter", frameworks: ["flutter"] };
  }

  // iOS
  const hasXcodeproj = entries.some((e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace"));
  const hasPackageSwift = hasFile("Package.swift");
  if (hasXcodeproj || hasPackageSwift) {
    const frameworks: UIFramework[] = [];
    // Check for SwiftUI vs UIKit by sampling swift files
    const swiftFiles = await findFiles(projectPath, [".swift"], 15);
    let hasSwiftUI = false;
    let hasUIKit = false;
    for (const f of swiftFiles.slice(0, 20)) {
      const content = await fs.readFile(f, "utf-8").catch(() => "");
      if (content.includes("import SwiftUI")) hasSwiftUI = true;
      if (content.includes("import UIKit") || content.includes("UIViewController")) hasUIKit = true;
    }
    if (hasSwiftUI) frameworks.push("swiftui");
    if (hasUIKit) frameworks.push("uikit");
    const storyboards = await findFiles(projectPath, [".storyboard"], 15);
    if (storyboards.length > 0) frameworks.push("storyboard");
    if (frameworks.length === 0) frameworks.push("unknown");
    return { platform: "ios", frameworks };
  }

  // Android
  if (hasFile("build.gradle") || hasFile("build.gradle.kts") || hasFile("settings.gradle") || hasFile("settings.gradle.kts")) {
    const frameworks: UIFramework[] = [];
    const ktFiles = await findFiles(projectPath, [".kt"], 15);
    let hasCompose = false;
    for (const f of ktFiles.slice(0, 20)) {
      const content = await fs.readFile(f, "utf-8").catch(() => "");
      if (content.includes("@Composable")) hasCompose = true;
    }
    if (hasCompose) frameworks.push("jetpack-compose");
    const xmlLayouts = await findFiles(projectPath, [".xml"], 15);
    const layoutXmls = xmlLayouts.filter((f) => f.includes("/layout/") || f.includes("/layout-"));
    if (layoutXmls.length > 0) frameworks.push("android-xml");
    if (frameworks.length === 0) frameworks.push("unknown");
    return { platform: "android", frameworks };
  }

  return { platform: "unknown", frameworks: ["unknown"] };
}

/** Try to extract app ID from project config files */
async function extractAppId(projectPath: string, platform: ProjectPlatform): Promise<string | undefined> {
  try {
    if (platform === "react-native") {
      // app.json
      const appJson = JSON.parse(await fs.readFile(path.join(projectPath, "app.json"), "utf-8"));
      return appJson.expo?.android?.package || appJson.expo?.ios?.bundleIdentifier || appJson.name;
    }
    if (platform === "android") {
      // Look in AndroidManifest.xml
      const manifests = await findFiles(projectPath, ["AndroidManifest.xml"], 15);
      for (const m of manifests) {
        const content = await fs.readFile(m, "utf-8");
        const match = content.match(/package="([^"]+)"/);
        if (match) return match[1];
      }
    }
    if (platform === "ios") {
      // Look in Info.plist for CFBundleIdentifier or .pbxproj
      const plists = await findFiles(projectPath, ["Info.plist"], 15);
      for (const p of plists) {
        const content = await fs.readFile(p, "utf-8");
        const match = content.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
        if (match && !match[1].includes("$(")) return match[1];
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Scan a project directory and analyze all screens */
export async function scanProject(
  projectPath: string,
  opts?: { maxFiles?: number }
): Promise<ProjectScanResult> {
  const maxFiles = opts?.maxFiles ?? 100;
  const { platform, frameworks } = await detectPlatform(projectPath);

  // Find source files
  const swiftFiles = await findFiles(projectPath, [".swift"]);
  const kotlinFiles = await findFiles(projectPath, [".kt"]);
  const xmlFiles = (await findFiles(projectPath, [".xml"])).filter(
    (f) => f.includes("/layout/") || f.includes("/layout-")
  );
  const storyboardFiles = await findFiles(projectPath, [".storyboard"]);

  // Build string map and component registry in parallel (first pass)
  const [appId, stringMap, componentRegistry] = await Promise.all([
    extractAppId(projectPath, platform),
    buildStringMap(projectPath),
    buildComponentRegistry(projectPath),
  ]);

  const analyzerOpts = { stringMap, componentRegistry };

  // Analyze screens (second pass)
  const screens: DiscoveredScreen[] = [];

  // Swift files
  for (const file of swiftFiles.slice(0, maxFiles)) {
    const content = await fs.readFile(file, "utf-8").catch(() => "");
    if (!content) continue;
    const fileScreens = analyzeSwiftFile(file, content, analyzerOpts);
    screens.push(...fileScreens);
  }

  // Kotlin files
  for (const file of kotlinFiles.slice(0, maxFiles)) {
    const content = await fs.readFile(file, "utf-8").catch(() => "");
    if (!content) continue;
    const fileScreens = analyzeKotlinFile(file, content, analyzerOpts);
    screens.push(...fileScreens);
  }

  // Android layout XMLs
  for (const file of xmlFiles.slice(0, maxFiles)) {
    const content = await fs.readFile(file, "utf-8").catch(() => "");
    if (!content) continue;
    const fileScreens = analyzeLayoutXml(file, content);
    screens.push(...fileScreens);
  }

  return {
    projectPath,
    platform,
    frameworks,
    appId,
    screens,
    sourceFiles: {
      swift: swiftFiles.length,
      kotlin: kotlinFiles.length,
      xml: xmlFiles.length,
      storyboard: storyboardFiles.length,
    },
  };
}

/** Read and analyze a single source file */
export async function analyzeFile(
  filePath: string
): Promise<{ screens: DiscoveredScreen[]; content: string }> {
  const content = await fs.readFile(filePath, "utf-8");
  const ext = path.extname(filePath);

  let screens: DiscoveredScreen[] = [];
  if (ext === ".swift") {
    screens = analyzeSwiftFile(filePath, content);
  } else if (ext === ".kt" || ext === ".java") {
    screens = analyzeKotlinFile(filePath, content);
  } else if (ext === ".xml" && (filePath.includes("/layout/") || filePath.includes("/layout-"))) {
    screens = analyzeLayoutXml(filePath, content);
  }

  return { screens, content };
}
