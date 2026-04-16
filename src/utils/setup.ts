import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface SetupCheck {
  name: string;
  status: "ok" | "missing" | "error";
  version?: string;
  path?: string;
  message?: string;
  installCmd?: string;
  autoInstall?: boolean;
}

export interface SetupResult {
  checks: SetupCheck[];
  devices: Array<{ id: string; name: string; platform: string }>;
  ready: boolean;
  summary: string;
}

const ANDROID_HOME =
  process.env.ANDROID_HOME ||
  path.join(process.env.HOME || "", "Library", "Android", "sdk");

/** Run a command and return stdout, or null on failure */
async function tryExec(
  cmd: string,
  args: string[],
  opts?: { timeout?: number }
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 15_000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Find an executable on PATH or known locations */
function findBin(name: string, extraPaths: string[] = []): string | null {
  for (const p of extraPaths) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // not found here
    }
  }
  // Will be resolved by shell PATH
  return name;
}

/** Full environment diagnostic */
export async function runSetup(opts?: {
  autoInstall?: boolean;
}): Promise<SetupResult> {
  const checks: SetupCheck[] = [];
  const autoInstall = opts?.autoInstall ?? false;

  // 1. Node.js
  const nodeVersion = await tryExec("node", ["--version"]);
  checks.push({
    name: "Node.js",
    status: nodeVersion ? "ok" : "missing",
    version: nodeVersion ?? undefined,
    message: nodeVersion ? undefined : "Node.js not found",
    installCmd: "https://nodejs.org/ or: brew install node",
  });

  // 2. Maestro CLI
  let maestroVersion = await tryExec("maestro", ["--version"]);
  if (!maestroVersion) {
    if (autoInstall) {
      // Try to install Maestro
      const installResult = await tryExec("bash", [
        "-c",
        "curl -Ls 'https://get.maestro.mobile.dev' | bash",
      ], { timeout: 120_000 });
      if (installResult) {
        // Re-check after install
        maestroVersion = await tryExec(
          path.join(process.env.HOME || "", ".maestro", "bin", "maestro"),
          ["--version"]
        );
      }
    }
    if (!maestroVersion) {
      checks.push({
        name: "Maestro CLI",
        status: "missing",
        message: "Maestro CLI not found. Required for running test flows.",
        installCmd: "curl -Ls 'https://get.maestro.mobile.dev' | bash",
        autoInstall: true,
      });
    }
  }
  if (maestroVersion) {
    checks.push({
      name: "Maestro CLI",
      status: "ok",
      version: maestroVersion,
    });
  }

  // 3. Android SDK / ADB
  const adbPaths = [
    path.join(ANDROID_HOME, "platform-tools", "adb"),
    "/usr/local/bin/adb",
  ];
  const adbBin = findBin("adb", adbPaths);
  const adbVersion = adbBin ? await tryExec(adbBin, ["version"]) : null;
  if (adbVersion) {
    const versionLine = adbVersion.split("\n")[0] ?? adbVersion;
    checks.push({
      name: "Android SDK (ADB)",
      status: "ok",
      version: versionLine,
      path: adbBin ?? undefined,
    });
  } else {
    checks.push({
      name: "Android SDK (ADB)",
      status: "missing",
      message: "ADB not found. Required for Android device interaction.",
      installCmd: "Install Android Studio or: brew install --cask android-platform-tools",
      autoInstall: false,
    });
  }

  // 4. Android emulator
  const emulatorBin = path.join(ANDROID_HOME, "emulator", "emulator");
  const emulatorVersion = await tryExec(emulatorBin, ["-version"]);
  if (emulatorVersion) {
    const versionLine = emulatorVersion.split("\n")[0] ?? emulatorVersion;
    checks.push({
      name: "Android Emulator",
      status: "ok",
      version: versionLine,
      path: emulatorBin,
    });
  } else {
    checks.push({
      name: "Android Emulator",
      status: "missing",
      message: "Android emulator not found. Install via Android Studio SDK Manager.",
      installCmd: "Android Studio → SDK Manager → SDK Tools → Android Emulator",
      autoInstall: false,
    });
  }

  // 5. Xcode / xcrun simctl
  const xcrunVersion = await tryExec("xcrun", ["simctl", "help"]);
  if (xcrunVersion !== null) {
    const xcodeBuild = await tryExec("xcodebuild", ["-version"]);
    checks.push({
      name: "Xcode (simctl)",
      status: "ok",
      version: xcodeBuild?.split("\n")[0] ?? "available",
    });
  } else {
    checks.push({
      name: "Xcode (simctl)",
      status: "missing",
      message: "xcrun simctl not found. Required for iOS simulator tools.",
      installCmd: "Install Xcode from App Store, then: xcode-select --install",
      autoInstall: false,
    });
  }

  // 6. Java (required by Maestro)
  const javaVersion = await tryExec("java", ["-version"]);
  // java -version outputs to stderr, try alternative
  const javaCheck = javaVersion ?? await tryExec("java", ["--version"]);
  if (javaCheck) {
    const versionLine = javaCheck.split("\n")[0] ?? javaCheck;
    checks.push({
      name: "Java Runtime",
      status: "ok",
      version: versionLine,
    });
  } else {
    if (autoInstall) {
      await tryExec("brew", ["install", "openjdk"], { timeout: 300_000 });
      const recheck = await tryExec("java", ["--version"]);
      if (recheck) {
        checks.push({ name: "Java Runtime", status: "ok", version: recheck.split("\n")[0] });
      }
    }
    if (!checks.some((c) => c.name === "Java Runtime")) {
      checks.push({
        name: "Java Runtime",
        status: "missing",
        message: "Java not found. Required by Maestro CLI.",
        installCmd: "brew install openjdk",
        autoInstall: true,
      });
    }
  }

  // 7. idb_companion (optional, for faster iOS interaction)
  const idbVersion = await tryExec("idb_companion", ["--version"]);
  if (idbVersion) {
    checks.push({
      name: "idb_companion (optional)",
      status: "ok",
      version: idbVersion,
    });
  } else {
    checks.push({
      name: "idb_companion (optional)",
      status: "missing",
      message: "idb_companion not found. Optional but improves Maestro iOS performance.",
      installCmd: "brew tap facebook/fb && brew install idb-companion",
      autoInstall: true,
    });
  }

  // Collect devices
  const devices: Array<{ id: string; name: string; platform: string }> = [];

  // Android devices
  if (adbBin) {
    const adbDevices = await tryExec(adbBin, ["devices", "-l"]);
    if (adbDevices) {
      for (const line of adbDevices.split("\n")) {
        if (line.includes("device ") && !line.startsWith("List")) {
          const [id] = line.split(/\s+/);
          const nameMatch = line.match(/model:(\S+)/);
          devices.push({ id, name: nameMatch?.[1] ?? id, platform: "android" });
        }
      }
    }
  }

  // iOS simulators (booted)
  if (xcrunVersion !== null) {
    const simList = await tryExec("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
    if (simList) {
      try {
        const data = JSON.parse(simList);
        for (const runtime of Object.keys(data.devices ?? {})) {
          for (const device of data.devices[runtime]) {
            if (device.state === "Booted") {
              devices.push({ id: device.udid, name: device.name, platform: "ios" });
            }
          }
        }
      } catch {
        // parse error
      }
    }
  }

  const okCount = checks.filter((c) => c.status === "ok").length;
  const missingCount = checks.filter((c) => c.status === "missing").length;
  const ready = checks
    .filter((c) => !c.name.includes("optional"))
    .every((c) => c.status === "ok");

  const summary = ready
    ? `All ${okCount} required tools ready. ${devices.length} device(s) connected.`
    : `${okCount} tools OK, ${missingCount} missing. Install missing tools to proceed.`;

  return { checks, devices, ready, summary };
}

/** Install a specific tool by name */
export async function installTool(
  toolName: string
): Promise<{ success: boolean; output: string }> {
  const installCommands: Record<string, { cmd: string; args: string[]; timeout: number }> = {
    maestro: {
      cmd: "bash",
      args: ["-c", "curl -Ls 'https://get.maestro.mobile.dev' | bash"],
      timeout: 120_000,
    },
    java: {
      cmd: "brew",
      args: ["install", "openjdk"],
      timeout: 300_000,
    },
    idb_companion: {
      cmd: "bash",
      args: ["-c", "brew tap facebook/fb && brew install idb-companion"],
      timeout: 300_000,
    },
  };

  const entry = installCommands[toolName.toLowerCase()];
  if (!entry) {
    return {
      success: false,
      output: `No auto-installer for "${toolName}". Manual install required.`,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(entry.cmd, entry.args, {
      timeout: entry.timeout,
      env: { ...process.env, NONINTERACTIVE: "1" },
    });
    return { success: true, output: stdout + (stderr ? `\n${stderr}` : "") };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: error.stderr ?? error.message ?? "Install failed",
    };
  }
}
