/** Detected project platform */
export type ProjectPlatform = "ios" | "android" | "react-native" | "flutter" | "unknown";

/** UI framework detected in the project */
export type UIFramework =
  | "swiftui"
  | "uikit"
  | "storyboard"
  | "jetpack-compose"
  | "android-xml"
  | "react-native"
  | "flutter"
  | "unknown";

/** A screen/view/activity discovered in the project */
export interface DiscoveredScreen {
  name: string;
  filePath: string;
  platform: "ios" | "android";
  framework: UIFramework;
  /** Type: Activity, Fragment, ViewController, SwiftUI View, Composable */
  type: string;
  /** UI elements found in this screen */
  elements: UIElement[];
  /** Navigation targets (screens this screen navigates to) */
  navigationTargets: string[];
}

/** A UI element extracted from source code */
export interface UIElement {
  kind: "button" | "textField" | "label" | "image" | "list" | "toggle" | "picker" | "link" | "other";
  /** The user-visible text or placeholder */
  text?: string;
  /** Accessibility identifier */
  accessibilityId?: string;
  /** Resource ID (Android) or tag */
  resourceId?: string;
  /** Whether this element triggers navigation */
  isNavigationTrigger?: boolean;
  /** Text resolved from string resources (R.string.*, Localizable.strings) */
  resolvedText?: string;
}

/** Result of scanning a project */
export interface ProjectScanResult {
  projectPath: string;
  platform: ProjectPlatform;
  frameworks: UIFramework[];
  appId?: string;
  screens: DiscoveredScreen[];
  entryPoint?: string;
  sourceFiles: { swift: number; kotlin: number; xml: number; storyboard: number };
}

/** Result of analyzing a single source file */
export interface FileAnalysisResult {
  filePath: string;
  platform: "ios" | "android";
  framework: UIFramework;
  screens: DiscoveredScreen[];
  imports: string[];
  rawExtracts: string[];
}
