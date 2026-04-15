export interface MaestroDevice {
  id: string;
  name: string;
  platform: "android" | "ios";
  status: "connected" | "disconnected" | "booting";
  isEmulator: boolean;
}

export interface MaestroFlowResult {
  success: boolean;
  flowPath: string;
  duration: number;
  output: string;
  errors: string[];
  screenshots: string[];
}

export interface MaestroCommand {
  action: string;
  params: Record<string, unknown>;
}

export interface FlowStep {
  action:
    | "launchApp"
    | "tapOn"
    | "inputText"
    | "assertVisible"
    | "assertNotVisible"
    | "scrollUntilVisible"
    | "swipe"
    | "back"
    | "hideKeyboard"
    | "waitForAnimationToEnd"
    | "takeScreenshot"
    | "clearState"
    | "openLink"
    | "pressKey"
    | "eraseText"
    | "pasteText"
    | "scroll"
    | "waitUntilVisible"
    | "runFlow"
    | "stopApp"
    | "clearKeychain"
    | "setLocation"
    | "repeat"
    | "evalScript";
  params: Record<string, unknown>;
}

export interface FlowConfig {
  appId: string;
  name?: string;
  tags?: string[];
  env?: Record<string, string>;
  onFlowStart?: FlowStep[];
  onFlowComplete?: FlowStep[];
}

export interface GeneratedFlow {
  path: string;
  yaml: string;
  config: FlowConfig;
  steps: FlowStep[];
  isTemporary: boolean;
}

export interface ScreenshotResult {
  path: string;
  base64: string;
  timestamp: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: "android" | "ios";
  osVersion: string;
  isEmulator: boolean;
  screenSize?: { width: number; height: number };
}
