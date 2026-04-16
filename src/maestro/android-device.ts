import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import path from "node:path";

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

const EMULATOR_BIN = path.join(ANDROID_HOME, "emulator", "emulator");

const AVDMANAGER_BIN = (() => {
  const candidates = [
    path.join(ANDROID_HOME, "cmdline-tools", "latest", "bin", "avdmanager"),
    path.join(ANDROID_HOME, "tools", "bin", "avdmanager"),
  ];
  for (const c of candidates) {
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch { /* next */ }
  }
  return "avdmanager";
})();

/** Android device capabilities — mirrors IOSSimulator API */
export class AndroidDevice {
  private adbArgs(deviceId?: string): string[] {
    return deviceId ? ["-s", deviceId] : [];
  }

  /** Open a URL (deep link / intent) on an Android device */
  async openUrl(
    url: string,
    deviceId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync(ADB_BIN, [
        ...this.adbArgs(deviceId),
        "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url,
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "openUrl failed" };
    }
  }

  /** Grant or revoke a permission for an app */
  async setPermission(
    action: "grant" | "revoke",
    permission: string,
    packageName: string,
    deviceId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync(ADB_BIN, [
        ...this.adbArgs(deviceId),
        "shell", "pm", action, packageName, permission,
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "permission failed" };
    }
  }

  /** Set simulated GPS location on emulator */
  async setLocation(
    latitude: number,
    longitude: number,
    deviceId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync(ADB_BIN, [
        ...this.adbArgs(deviceId),
        "emu", "geo", "fix", String(longitude), String(latitude),
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "setLocation failed" };
    }
  }

  /** Enable demo mode and override status bar on Android */
  async overrideStatusBar(
    overrides: {
      time?: string;
      wifi?: boolean;
      wifiLevel?: number;
      mobile?: boolean;
      mobileLevel?: number;
      batteryLevel?: number;
      batteryCharging?: boolean;
      notifications?: boolean;
    },
    deviceId?: string
  ): Promise<{ success: boolean; error?: string }> {
    const args = this.adbArgs(deviceId);
    try {
      // Enable demo mode
      await execFileAsync(ADB_BIN, [
        ...args, "shell", "settings", "put", "global", "sysui_demo_allowed", "1",
      ]);
      await execFileAsync(ADB_BIN, [
        ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
        "-e", "command", "enter",
      ]);

      // Clock
      if (overrides.time) {
        // Format: HHmm (e.g., "0941" for 9:41)
        const hhmm = overrides.time.replace(":", "").padStart(4, "0");
        await execFileAsync(ADB_BIN, [
          ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
          "-e", "command", "clock", "-e", "hhmm", hhmm,
        ]);
      }

      // Wifi
      if (overrides.wifi !== undefined) {
        await execFileAsync(ADB_BIN, [
          ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
          "-e", "command", "network",
          "-e", "wifi", overrides.wifi ? "show" : "hide",
          ...(overrides.wifiLevel !== undefined ? ["-e", "level", String(overrides.wifiLevel)] : []),
        ]);
      }

      // Mobile
      if (overrides.mobile !== undefined) {
        await execFileAsync(ADB_BIN, [
          ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
          "-e", "command", "network",
          "-e", "mobile", overrides.mobile ? "show" : "hide",
          ...(overrides.mobileLevel !== undefined ? ["-e", "level", String(overrides.mobileLevel)] : []),
        ]);
      }

      // Battery
      if (overrides.batteryLevel !== undefined || overrides.batteryCharging !== undefined) {
        await execFileAsync(ADB_BIN, [
          ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
          "-e", "command", "battery",
          ...(overrides.batteryLevel !== undefined ? ["-e", "level", String(overrides.batteryLevel)] : []),
          ...(overrides.batteryCharging !== undefined ? ["-e", "plugged", overrides.batteryCharging ? "true" : "false"] : []),
        ]);
      }

      // Notifications
      if (overrides.notifications === false) {
        await execFileAsync(ADB_BIN, [
          ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
          "-e", "command", "notifications", "-e", "visible", "false",
        ]);
      }

      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "status_bar failed" };
    }
  }

  /** Clear demo mode / status bar overrides */
  async clearStatusBar(deviceId?: string): Promise<{ success: boolean; error?: string }> {
    const args = this.adbArgs(deviceId);
    try {
      await execFileAsync(ADB_BIN, [
        ...args, "shell", "am", "broadcast", "-a", "com.android.systemui.demo",
        "-e", "command", "exit",
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "clearStatusBar failed" };
    }
  }

  /** List available AVDs (Android Virtual Devices) */
  async listEmulators(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(EMULATOR_BIN, ["-list-avds"]);
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Boot an emulator AVD */
  async bootEmulator(
    avdName: string,
    opts?: { dnsServer?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ["-avd", avdName];
      if (opts?.dnsServer) args.push("-dns-server", opts.dnsServer);

      // Launch in background — don't wait for it to finish
      const { spawn: spawnProc } = await import("node:child_process");
      const proc = spawnProc(EMULATOR_BIN, args, {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      // Poll until device appears in adb (max 90s)
      const timeout = 90_000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const { stdout } = await execFileAsync(ADB_BIN, ["devices"]);
        if (stdout.includes("emulator-") && stdout.includes("device")) {
          return { success: true };
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      return { success: false, error: `Timeout waiting for ${avdName} to boot` };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "boot failed" };
    }
  }

  /** Shutdown an emulator */
  async shutdownEmulator(deviceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync(ADB_BIN, ["-s", deviceId, "emu", "kill"]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "shutdown failed" };
    }
  }

  /** Create a new AVD */
  async createEmulator(
    name: string,
    systemImage: string,
    device?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args = [
        "create", "avd",
        "-n", name,
        "-k", systemImage,
        "--force",
      ];
      if (device) args.push("-d", device);

      // avdmanager prompts for custom hardware — pipe "no" to skip
      const { stderr } = await execFileAsync(AVDMANAGER_BIN, args, {
        timeout: 60_000,
        env: { ...process.env },
      });
      return { success: true, error: stderr || undefined };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "create failed" };
    }
  }

  /** Delete an AVD by name */
  async deleteEmulator(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync(AVDMANAGER_BIN, ["delete", "avd", "-n", name]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "delete failed" };
    }
  }

  /** List available device definitions (hardware profiles) */
  async listDeviceTypes(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(AVDMANAGER_BIN, ["list", "device", "-c"], {
        timeout: 30_000,
      });
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /** List installed system images */
  async listSystemImages(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        path.join(ANDROID_HOME, "cmdline-tools", "latest", "bin", "sdkmanager"),
        ["--list_installed"],
        { timeout: 30_000 }
      );
      return stdout
        .split("\n")
        .filter((l) => l.trim().startsWith("system-images;"))
        .map((l) => l.trim().split(/\s+/)[0]);
    } catch {
      return [];
    }
  }
}

/** Map common permission names to Android manifest permissions */
export const ANDROID_PERMISSIONS: Record<string, string> = {
  camera: "android.permission.CAMERA",
  location: "android.permission.ACCESS_FINE_LOCATION",
  "location-always": "android.permission.ACCESS_BACKGROUND_LOCATION",
  microphone: "android.permission.RECORD_AUDIO",
  contacts: "android.permission.READ_CONTACTS",
  calendar: "android.permission.READ_CALENDAR",
  photos: "android.permission.READ_MEDIA_IMAGES",
  "media-library": "android.permission.READ_MEDIA_AUDIO",
  reminders: "android.permission.READ_CALENDAR",
  siri: "android.permission.RECORD_AUDIO", // closest equivalent
};
