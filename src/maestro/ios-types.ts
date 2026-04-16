/** Raw device entry from `xcrun simctl list devices --json` */
export interface SimctlDevice {
  udid: string;
  name: string;
  state: "Booted" | "Shutdown" | "Shutting Down" | "Creating";
  isAvailable: boolean;
  deviceTypeIdentifier: string;
  dataPath?: string;
  logPath?: string;
  lastBootedAt?: string;
}

/** Parsed simulator info for API consumers */
export interface SimulatorInfo {
  udid: string;
  name: string;
  state: SimctlDevice["state"];
  runtime: string;
  runtimeVersion: string;
  deviceType: string;
  isAvailable: boolean;
}

/** Runtime entry from `xcrun simctl list runtimes --json` */
export interface SimctlRuntime {
  identifier: string;
  name: string;
  version: string;
  buildversion: string;
  isAvailable: boolean;
  supportedDeviceTypes?: Array<{
    identifier: string;
    name: string;
  }>;
}

/** Options for booting a simulator */
export interface BootOptions {
  /** Wait until fully booted (poll state). Default: true */
  waitUntilReady?: boolean;
  /** Max ms to wait for boot. Default: 90_000 */
  timeout?: number;
}

/** Privacy services supported by `xcrun simctl privacy` */
export type PrivacyService =
  | "all"
  | "calendar"
  | "contacts-limited"
  | "contacts"
  | "location"
  | "location-always"
  | "photos-add"
  | "photos"
  | "media-library"
  | "microphone"
  | "motion"
  | "reminders"
  | "siri"
  | "camera";

/** Privacy action for `xcrun simctl privacy` */
export type PrivacyAction = "grant" | "revoke" | "reset";

/** Status bar overrides for `xcrun simctl status_bar` */
export interface StatusBarOverrides {
  time?: string;
  dataNetwork?: "wifi" | "3g" | "4g" | "lte" | "lte-a" | "lte+" | "5g" | "5g+" | "5g-uwb";
  wifiMode?: "searching" | "failed" | "active";
  wifiBars?: 0 | 1 | 2 | 3;
  cellularMode?: "notSupported" | "searching" | "failed" | "active";
  cellularBars?: 0 | 1 | 2 | 3 | 4;
  batteryState?: "charging" | "charged" | "discharging";
  batteryLevel?: number;
  operatorName?: string;
}

/** APNs push notification payload for `xcrun simctl push` */
export interface PushPayload {
  aps: {
    alert?: string | { title?: string; body?: string; subtitle?: string };
    badge?: number;
    sound?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
