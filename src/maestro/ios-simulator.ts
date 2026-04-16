import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  SimctlDevice,
  SimctlRuntime,
  SimulatorInfo,
  BootOptions,
  PrivacyService,
  PrivacyAction,
  StatusBarOverrides,
  PushPayload,
} from "./ios-types.js";

const execFileAsync = promisify(execFile);

/**
 * Wrapper around `xcrun simctl` for iOS Simulator lifecycle management.
 */
export class IOSSimulator {
  /** Check if xcrun simctl is available */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("xcrun", ["simctl", "help"]);
      return true;
    } catch {
      return false;
    }
  }

  /** List all simulators, optionally including shutdown ones */
  async listSimulators(
    opts?: { includeShutdown?: boolean }
  ): Promise<SimulatorInfo[]> {
    const args = ["simctl", "list", "devices", "--json"];
    if (!opts?.includeShutdown) {
      args.splice(3, 0, "booted");
    }

    const { stdout } = await execFileAsync("xcrun", args);
    const data = JSON.parse(stdout) as {
      devices: Record<string, SimctlDevice[]>;
    };

    const results: SimulatorInfo[] = [];

    for (const [runtimeId, devices] of Object.entries(data.devices)) {
      // runtimeId format: "com.apple.CoreSimulator.SimRuntime.iOS-18-0"
      const runtimeVersion = runtimeId
        .replace(/.*\.iOS-/, "")
        .replace(/-/g, ".");

      for (const device of devices) {
        if (!opts?.includeShutdown && device.state !== "Booted") continue;

        results.push({
          udid: device.udid,
          name: device.name,
          state: device.state,
          runtime: runtimeId,
          runtimeVersion,
          deviceType: device.deviceTypeIdentifier,
          isAvailable: device.isAvailable,
        });
      }
    }

    return results;
  }

  /** List available runtimes */
  async listRuntimes(): Promise<SimctlRuntime[]> {
    const { stdout } = await execFileAsync("xcrun", [
      "simctl", "list", "runtimes", "--json",
    ]);
    const data = JSON.parse(stdout) as { runtimes: SimctlRuntime[] };
    return data.runtimes;
  }

  /** Boot a simulator by UDID. Polls until Booted or timeout. */
  async boot(
    udid: string,
    opts?: BootOptions
  ): Promise<{ success: boolean; duration: number; error?: string }> {
    const waitUntilReady = opts?.waitUntilReady ?? true;
    const timeout = opts?.timeout ?? 90_000;
    const start = Date.now();

    try {
      await execFileAsync("xcrun", ["simctl", "boot", udid]);
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      const msg = error.stderr ?? error.message ?? "Boot failed";
      // "Unable to boot device in current state: Booted" is not an error
      if (msg.includes("current state: Booted")) {
        return { success: true, duration: Date.now() - start };
      }
      return { success: false, duration: Date.now() - start, error: msg };
    }

    if (!waitUntilReady) {
      return { success: true, duration: Date.now() - start };
    }

    // Poll until state is Booted
    while (Date.now() - start < timeout) {
      const state = await this.getState(udid);
      if (state === "Booted") {
        return { success: true, duration: Date.now() - start };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    return {
      success: false,
      duration: Date.now() - start,
      error: `Timeout after ${timeout}ms waiting for simulator to boot`,
    };
  }

  /** Shutdown a simulator by UDID */
  async shutdown(
    udid: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", ["simctl", "shutdown", udid]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      const msg = error.stderr ?? error.message ?? "Shutdown failed";
      if (msg.includes("current state: Shutdown")) {
        return { success: true };
      }
      return { success: false, error: msg };
    }
  }

  /** Get current state of a simulator */
  async getState(
    udid: string
  ): Promise<SimctlDevice["state"] | null> {
    const sims = await this.listSimulators({ includeShutdown: true });
    const sim = sims.find((s) => s.udid === udid);
    return sim?.state ?? null;
  }

  /** Get detailed info for a single simulator */
  async getSimulatorInfo(
    udid: string
  ): Promise<SimulatorInfo | null> {
    const sims = await this.listSimulators({ includeShutdown: true });
    return sims.find((s) => s.udid === udid) ?? null;
  }

  // ── Phase 2: iOS-only capabilities ──────────────────

  /** Open a URL (deep link / universal link) in a booted simulator */
  async openUrl(
    udid: string,
    url: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", ["simctl", "openurl", udid, url]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "openurl failed" };
    }
  }

  /** Grant, revoke, or reset a privacy permission for an app */
  async setPermission(
    udid: string,
    action: PrivacyAction,
    service: PrivacyService,
    bundleId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", [
        "simctl", "privacy", udid, action, service, bundleId,
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "privacy command failed" };
    }
  }

  /** Send a simulated push notification to a booted simulator */
  async sendPush(
    udid: string,
    bundleId: string,
    payload: PushPayload
  ): Promise<{ success: boolean; error?: string }> {
    // simctl push requires a JSON file
    const tmpFile = path.join(
      os.tmpdir(),
      `maestro-mcp-push-${Date.now()}.json`
    );
    try {
      await fs.writeFile(tmpFile, JSON.stringify(payload));
      await execFileAsync("xcrun", [
        "simctl", "push", udid, bundleId, tmpFile,
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "push failed" };
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  /** Override the simulator status bar for clean screenshots */
  async overrideStatusBar(
    udid: string,
    overrides: StatusBarOverrides
  ): Promise<{ success: boolean; error?: string }> {
    const args = ["simctl", "status_bar", udid, "override"];

    if (overrides.time) args.push("--time", overrides.time);
    if (overrides.dataNetwork) args.push("--dataNetwork", overrides.dataNetwork);
    if (overrides.wifiMode) args.push("--wifiMode", overrides.wifiMode);
    if (overrides.wifiBars !== undefined) args.push("--wifiBars", String(overrides.wifiBars));
    if (overrides.cellularMode) args.push("--cellularMode", overrides.cellularMode);
    if (overrides.cellularBars !== undefined) args.push("--cellularBars", String(overrides.cellularBars));
    if (overrides.batteryState) args.push("--batteryState", overrides.batteryState);
    if (overrides.batteryLevel !== undefined) args.push("--batteryLevel", String(overrides.batteryLevel));
    if (overrides.operatorName) args.push("--operatorName", overrides.operatorName);

    try {
      await execFileAsync("xcrun", args);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "status_bar override failed" };
    }
  }

  /** Clear status bar overrides */
  async clearStatusBar(
    udid: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", ["simctl", "status_bar", udid, "clear"]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "status_bar clear failed" };
    }
  }

  // ── Phase 3: Advanced ───────────────────────

  /** Set simulated GPS location on a booted simulator */
  async setLocation(
    udid: string,
    latitude: number,
    longitude: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", [
        "simctl", "location", udid, "set",
        `${latitude},${longitude}`,
      ]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "location set failed" };
    }
  }

  /** Clear simulated GPS location */
  async clearLocation(
    udid: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", ["simctl", "location", udid, "clear"]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "location clear failed" };
    }
  }

  /** Create a new simulator. Returns UDID of the created device. */
  async createSimulator(
    name: string,
    deviceType: string,
    runtime: string
  ): Promise<{ success: boolean; udid?: string; error?: string }> {
    try {
      const { stdout } = await execFileAsync("xcrun", [
        "simctl", "create", name, deviceType, runtime,
      ]);
      return { success: true, udid: stdout.trim() };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "create failed" };
    }
  }

  /** Delete a simulator by UDID */
  async deleteSimulator(
    udid: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("xcrun", ["simctl", "delete", udid]);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      return { success: false, error: error.stderr ?? error.message ?? "delete failed" };
    }
  }
}
