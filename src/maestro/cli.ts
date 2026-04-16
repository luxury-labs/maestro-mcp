import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import type { MaestroDevice, MaestroFlowResult, DeviceInfo } from "./types.js";
import { parseDebugOutputDir } from "../diagnostics/error-patterns.js";
import { parseCommandsJson } from "../diagnostics/debug-report-parser.js";
import { readScreenshotSafe } from "../utils/screenshot.js";

const execFileAsync = promisify(execFile);

const ANDROID_HOME =
  process.env.ANDROID_HOME ||
  path.join(process.env.HOME || "", "Library", "Android", "sdk");

const ADB_BIN =
  process.env.ADB_BIN ||
  (() => {
    const candidate = path.join(ANDROID_HOME, "platform-tools", "adb");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      return "adb";
    }
  })();

const MAESTRO_BIN = process.env.MAESTRO_BIN || "maestro";
const DEFAULT_TIMEOUT = 120_000;

export class MaestroCli {
  private bin: string;
  private screenshotDir: string;

  constructor(opts?: { bin?: string; screenshotDir?: string }) {
    this.bin = opts?.bin ?? MAESTRO_BIN;
    this.screenshotDir =
      opts?.screenshotDir ?? path.join(process.cwd(), ".maestro-mcp", "screenshots");
  }

  /** Check if Maestro CLI is installed and reachable */
  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync(this.bin, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Get Maestro CLI version */
  async version(): Promise<string> {
    const { stdout } = await execFileAsync(this.bin, ["--version"]);
    return stdout.trim();
  }

  /** Detect platform from device ID: UUID = iOS, emulator-NNNN or other = Android */
  static detectPlatform(deviceId: string): "android" | "ios" {
    // iOS UDIDs are 36-char UUIDs (8-4-4-4-12)
    return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(deviceId)
      ? "ios"
      : "android";
  }

  /** List connected devices/emulators via ADB + xcrun */
  async listDevices(
    opts?: { includeShutdown?: boolean }
  ): Promise<MaestroDevice[]> {
    const devices: MaestroDevice[] = [];

    // Android devices via ADB
    try {
      const { stdout } = await execFileAsync(ADB_BIN, ["devices", "-l"]);
      const lines = stdout.split("\n").filter((l: string) => l.includes("device ") && !l.startsWith("List"));
      for (const line of lines) {
        const [id] = line.split(/\s+/);
        const isEmulator = id.startsWith("emulator-");
        const nameMatch = line.match(/model:(\S+)/);
        devices.push({
          id,
          name: nameMatch?.[1] ?? id,
          platform: "android",
          status: "connected",
          isEmulator,
        });
      }
    } catch {
      // ADB not available
    }

    // iOS simulators via xcrun
    try {
      const args = ["simctl", "list", "devices", "--json"];
      if (!opts?.includeShutdown) {
        args.splice(3, 0, "booted");
      }
      const { stdout } = await execFileAsync("xcrun", args);
      const data = JSON.parse(stdout);
      for (const runtime of Object.keys(data.devices ?? {})) {
        for (const device of data.devices[runtime]) {
          if (!opts?.includeShutdown && device.state !== "Booted") continue;
          devices.push({
            id: device.udid,
            name: device.name,
            platform: "ios",
            status: device.state === "Booted" ? "connected" : "disconnected",
            isEmulator: true,
          });
        }
      }
    } catch {
      // xcrun not available (non-macOS)
    }

    return devices;
  }

  /** Get detailed info about a specific device */
  async getDeviceInfo(deviceId: string): Promise<DeviceInfo | null> {
    const devices = await this.listDevices();
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return null;

    let osVersion = "unknown";
    try {
      if (device.platform === "android") {
        const { stdout } = await execFileAsync(ADB_BIN, [
          "-s", deviceId, "shell", "getprop", "ro.build.version.release",
        ]);
        osVersion = stdout.trim();
      } else {
        const { stdout } = await execFileAsync("xcrun", [
          "simctl", "getenv", deviceId, "SIMULATOR_RUNTIME_VERSION",
        ]);
        osVersion = stdout.trim();
      }
    } catch {
      // version retrieval failed
    }

    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      osVersion,
      isEmulator: device.isEmulator,
    };
  }

  /** Run a Maestro flow YAML file */
  async runFlow(
    flowPath: string,
    opts?: { deviceId?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<MaestroFlowResult> {
    const args: string[] = ["test", flowPath];
    if (opts?.deviceId) {
      args.unshift("--device", opts.deviceId);
    }
    if (opts?.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    const startTime = Date.now();
    const screenshots: string[] = [];

    try {
      const { stdout, stderr } = await execFileAsync(this.bin, args, {
        timeout: opts?.timeout ?? DEFAULT_TIMEOUT,
        env: { ...process.env, ...opts?.env },
      });

      return {
        success: true,
        flowPath,
        duration: Date.now() - startTime,
        output: stdout + (stderr ? `\n${stderr}` : ""),
        errors: [],
        screenshots,
      };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = error.stdout ?? "";
      const errors = [error.stderr ?? error.message ?? "Unknown error"];

      // Collect failure screenshots from Maestro debug output
      const debugDir = parseDebugOutputDir([output, ...errors].join("\n"));
      const failureScreenshots = await this.collectDebugScreenshots(debugDir);

      // Parse Maestro's commands JSON for detailed failure info + UI hierarchy
      const debugReport = debugDir ? await parseCommandsJson(debugDir) : null;

      // Also capture live screenshot of current device state
      const liveShot = await this.captureLiveFailureScreenshot(opts?.deviceId);
      if (liveShot) {
        failureScreenshots.push(liveShot);
      }

      return {
        success: false,
        flowPath,
        duration: Date.now() - startTime,
        output,
        errors,
        screenshots,
        debugDir: debugDir ?? undefined,
        failureScreenshots: failureScreenshots.length > 0 ? failureScreenshots : undefined,
        debugReport: debugReport ?? undefined,
      };
    }
  }

  /** Collect screenshot PNGs from Maestro's debug output directory */
  private async collectDebugScreenshots(
    debugDir: string | null
  ): Promise<Array<{ path: string; base64: string }>> {
    if (!debugDir) return [];

    try {
      const entries = await fs.readdir(debugDir);
      const pngs = entries.filter((e) => e.endsWith(".png"));
      const results: Array<{ path: string; base64: string }> = [];

      for (const png of pngs.slice(0, 5)) {
        // Limit to 5 screenshots
        const fullPath = path.join(debugDir, png);
        try {
          const base64 = await readScreenshotSafe(fullPath);
          results.push({ path: fullPath, base64 });
        } catch {
          // Skip corrupted/oversized screenshots
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /** Take a live screenshot on failure for diagnosis */
  private async captureLiveFailureScreenshot(
    deviceId?: string
  ): Promise<{ path: string; base64: string } | null> {
    try {
      const result = await this.takeScreenshot(`failure-live-${Date.now()}.png`, deviceId);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Minimum file size (bytes) for a valid screenshot.
   * A black/empty screencap on a 1080x2400 display is ~10KB.
   * Real content is typically >50KB. We use 20KB as threshold.
   */
  private static MIN_SCREENSHOT_SIZE = 20 * 1024;

  /** Try `adb emu screenrecord screenshot` (emulator-only, saves to host). */
  private async screenshotViaEmu(
    adbDeviceArgs: string[],
    destPath: string
  ): Promise<void> {
    await execFileAsync(ADB_BIN, [
      ...adbDeviceArgs, "emu", "screenrecord", "screenshot", destPath,
    ]);
  }

  /** Try `adb exec-out screencap -p` and validate result isn't empty. */
  private async screenshotViaScreencap(
    adbDeviceArgs: string[],
    destPath: string
  ): Promise<boolean> {
    const { stdout } = await execFileAsync(ADB_BIN, [
      ...adbDeviceArgs, "exec-out", "screencap", "-p",
    ], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
    await fs.writeFile(destPath, stdout);
    const stat = await fs.stat(destPath);
    return stat.size >= MaestroCli.MIN_SCREENSHOT_SIZE;
  }

  /** Take a screenshot of connected device */
  async takeScreenshot(
    filename?: string,
    deviceId?: string
  ): Promise<{ path: string; base64: string }> {
    await fs.mkdir(this.screenshotDir, { recursive: true });

    const screenshotName = filename ?? `screenshot-${Date.now()}.png`;
    const screenshotPath = path.join(this.screenshotDir, screenshotName);
    const adbDeviceArgs = deviceId ? ["-s", deviceId] : [];

    let captured = false;

    // 1. Try ADB screencap (works on real devices + most emulators)
    try {
      const valid = await this.screenshotViaScreencap(adbDeviceArgs, screenshotPath);
      if (valid) {
        captured = true;
      } else {
        // screencap returned a suspiciously small image (likely black).
        // Fall back to emulator console screenshot.
        try {
          await this.screenshotViaEmu(adbDeviceArgs, screenshotPath);
          captured = true;
        } catch {
          // emu command not available (real device) — keep the screencap result
          captured = true;
        }
      }
    } catch {
      // ADB not available — try emulator console, then iOS
      try {
        await this.screenshotViaEmu(adbDeviceArgs, screenshotPath);
        captured = true;
      } catch {
        // Try xcrun simctl for iOS
        const simTarget = deviceId ?? "booted";
        await execFileAsync("xcrun", [
          "simctl", "io", simTarget, "screenshot", screenshotPath,
        ]);
        captured = true;
      }
    }

    if (!captured) {
      throw new Error("Failed to capture screenshot from any source");
    }

    const base64 = await readScreenshotSafe(screenshotPath);
    return {
      path: screenshotPath,
      base64,
    };
  }

  /** Install an app on device. Supports .apk (Android), .app and .ipa (iOS). */
  async installApp(
    appPath: string,
    deviceId?: string
  ): Promise<{ success: boolean; output: string }> {
    try {
      if (appPath.endsWith(".apk")) {
        const args = deviceId
          ? ["-s", deviceId, "install", "-r", appPath]
          : ["install", "-r", appPath];
        const { stdout } = await execFileAsync(ADB_BIN, args);
        return { success: true, output: stdout };
      } else if (appPath.endsWith(".app") || appPath.endsWith(".ipa")) {
        const simTarget = deviceId ?? "booted";
        const { stdout } = await execFileAsync("xcrun", [
          "simctl", "install", simTarget, appPath,
        ]);
        return { success: true, output: stdout };
      }
      return { success: false, output: `Unsupported format: ${appPath}. Use .apk (Android) or .app/.ipa (iOS)` };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, output: error.message ?? "Install failed" };
    }
  }

  /** Launch app by package/bundle ID */
  async launchApp(
    appId: string,
    opts?: { deviceId?: string; clearState?: boolean }
  ): Promise<{ success: boolean; output: string }> {
    // Use maestro to launch — generates a temp flow
    const steps = [];
    if (opts?.clearState) {
      steps.push(`- clearState: ${appId}`);
    }
    steps.push(`- launchApp: ${appId}`);

    const yaml = `appId: ${appId}\n---\n${steps.join("\n")}\n`;
    const tmpPath = path.join(this.screenshotDir, "..", "tmp", `launch-${Date.now()}.yaml`);
    await fs.mkdir(path.dirname(tmpPath), { recursive: true });
    await fs.writeFile(tmpPath, yaml);

    try {
      const result = await this.runFlow(tmpPath, { deviceId: opts?.deviceId });
      return { success: result.success, output: result.output };
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  /** Stop/kill app by package/bundle ID */
  async stopApp(
    appId: string,
    deviceId?: string
  ): Promise<{ success: boolean; output: string }> {
    const platform = deviceId ? MaestroCli.detectPlatform(deviceId) : "android";

    try {
      if (platform === "ios") {
        const simTarget = deviceId ?? "booted";
        const { stdout } = await execFileAsync("xcrun", [
          "simctl", "terminate", simTarget, appId,
        ]);
        return { success: true, output: stdout };
      }

      // Android
      const args = deviceId
        ? ["-s", deviceId, "shell", "am", "force-stop", appId]
        : ["shell", "am", "force-stop", appId];
      const { stdout } = await execFileAsync(ADB_BIN, args);
      return { success: true, output: stdout };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, output: error.message ?? "Stop failed" };
    }
  }
}
