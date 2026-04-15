import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import type { MaestroDevice, MaestroFlowResult, DeviceInfo } from "./types.js";

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

  /** List connected devices/emulators via ADB + xcrun */
  async listDevices(): Promise<MaestroDevice[]> {
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
      const { stdout } = await execFileAsync("xcrun", [
        "simctl",
        "list",
        "devices",
        "booted",
        "--json",
      ]);
      const data = JSON.parse(stdout);
      for (const runtime of Object.keys(data.devices ?? {})) {
        for (const device of data.devices[runtime]) {
          if (device.state === "Booted") {
            devices.push({
              id: device.udid,
              name: device.name,
              platform: "ios",
              status: "connected",
              isEmulator: true,
            });
          }
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
      return {
        success: false,
        flowPath,
        duration: Date.now() - startTime,
        output: error.stdout ?? "",
        errors: [error.stderr ?? error.message ?? "Unknown error"],
        screenshots,
      };
    }
  }

  /** Take a screenshot of connected device */
  async takeScreenshot(
    filename?: string,
    deviceId?: string
  ): Promise<{ path: string; base64: string }> {
    await fs.mkdir(this.screenshotDir, { recursive: true });

    const screenshotName = filename ?? `screenshot-${Date.now()}.png`;
    const screenshotPath = path.join(this.screenshotDir, screenshotName);

    if (deviceId) {
      // Use ADB for android or xcrun for iOS
      try {
        // Try ADB first
        await execFileAsync(ADB_BIN, [
          "-s", deviceId, "exec-out", "screencap", "-p",
        ]);
        const { stdout: screencap } = await execFileAsync(ADB_BIN, [
          "-s", deviceId, "exec-out", "screencap", "-p",
        ]);
        await fs.writeFile(screenshotPath, screencap, "binary");
      } catch {
        // Try xcrun simctl for iOS
        await execFileAsync("xcrun", [
          "simctl", "io", deviceId, "screenshot", screenshotPath,
        ]);
      }
    } else {
      // Default: use ADB
      const { stdout } = await execFileAsync(ADB_BIN, [
        "exec-out", "screencap", "-p",
      ]);
      await fs.writeFile(screenshotPath, stdout, "binary");
    }

    const buffer = await fs.readFile(screenshotPath);
    return {
      path: screenshotPath,
      base64: buffer.toString("base64"),
    };
  }

  /** Install an app on device */
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
      } else if (appPath.endsWith(".app")) {
        const args = deviceId
          ? ["simctl", "install", deviceId, appPath]
          : ["simctl", "install", "booted", appPath];
        const { stdout } = await execFileAsync("xcrun", args);
        return { success: true, output: stdout };
      }
      return { success: false, output: `Unsupported app format: ${appPath}` };
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
    try {
      // Android
      const args = deviceId
        ? ["-s", deviceId, "shell", "am", "force-stop", appId]
        : ["shell", "am", "force-stop", appId];
      const { stdout } = await execFileAsync(ADB_BIN, args);
      return { success: true, output: stdout };
    } catch {
      try {
        // iOS - terminate via simctl
        const args = deviceId
          ? ["simctl", "terminate", deviceId, appId]
          : ["simctl", "terminate", "booted", appId];
        const { stdout } = await execFileAsync("xcrun", args);
        return { success: true, output: stdout };
      } catch (err: unknown) {
        const error = err as { message?: string };
        return { success: false, output: error.message ?? "Stop failed" };
      }
    }
  }
}
