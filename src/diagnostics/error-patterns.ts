/**
 * Pattern-based diagnostics for common mobile E2E test failures.
 * Analyzes Maestro CLI output text and provides structured suggestions.
 */

export interface FlowDiagnostic {
  category: "metro" | "element" | "app_crash" | "timeout" | "network" | "parse" | "device" | "unknown";
  problem: string;
  suggestions: string[];
  severity: "critical" | "error" | "warning";
}

interface Pattern {
  regex: RegExp;
  diagnostic: Omit<FlowDiagnostic, "severity"> & { severity: FlowDiagnostic["severity"] };
}

const PATTERNS: Pattern[] = [
  // React Native Metro bundler not connected
  {
    regex: /Unable to load script.*(?:Metro|index\.android\.bundle|index\.ios\.bundle)/is,
    diagnostic: {
      category: "metro",
      problem: "Metro bundler not connected to device. App cannot load JS bundle.",
      suggestions: [
        "Start Metro: cd <app-dir> && npx expo start (or npx react-native start)",
        "For emulator: ensure adb reverse tcp:8081 tcp:8081 is set",
        "For physical device: ensure device and computer are on same Wi-Fi network",
        "Alternative: build a release bundle instead of dev mode",
      ],
      severity: "critical",
    },
  },
  // Element not found
  {
    regex: /Element not found:.*Text matching regex:\s*(.+)/i,
    diagnostic: {
      category: "element",
      problem: "Element not found on screen. UI may have changed or not loaded yet.",
      suggestions: [
        "Take a screenshot to see current screen state",
        "Add waitForAnimationToEnd or waitUntilVisible before the failing step",
        "Verify element text matches exactly (case-sensitive)",
        "App may be on a different screen than expected (e.g. still on splash/login)",
        "Check if element uses accessibility ID instead of visible text",
      ],
      severity: "error",
    },
  },
  // App crash / ANR
  {
    regex: /(?:Application.*(?:crashed|not responding|has stopped)|ANR|FATAL EXCEPTION)/i,
    diagnostic: {
      category: "app_crash",
      problem: "App crashed or became unresponsive during test.",
      suggestions: [
        "Check logcat/device logs for crash stack trace: adb logcat -d | grep -i fatal",
        "Restart app with clearState: true to reset to clean state",
        "Verify app is built correctly and all native dependencies are linked",
      ],
      severity: "critical",
    },
  },
  // Timeout
  {
    regex: /(?:timed?\s*out|timeout|exceeded.*time)/i,
    diagnostic: {
      category: "timeout",
      problem: "Operation timed out waiting for condition or element.",
      suggestions: [
        "Increase timeout for slow operations (waitForAnimationToEnd timeout: 10000)",
        "Network requests may be slow — check device connectivity",
        "App may be stuck on loading screen — verify backend is reachable",
      ],
      severity: "error",
    },
  },
  // Network error on screen
  {
    regex: /(?:Network\s*Error|ECONNREFUSED|Failed to fetch|net::ERR_|Unable to resolve host)/i,
    diagnostic: {
      category: "network",
      problem: "Network connectivity issue detected.",
      suggestions: [
        "Emulator: ensure host backend is accessible (use 10.0.2.2 for Android emulator localhost)",
        "Check internet connectivity: adb shell ping -c 1 google.com",
        "Verify API base URL configuration for dev/emulator environment",
        "For Supabase/Firebase: check if API keys and URLs are correct in .env",
      ],
      severity: "error",
    },
  },
  // YAML parsing error
  {
    regex: /Parsing Failed/i,
    diagnostic: {
      category: "parse",
      problem: "Maestro flow YAML has syntax or schema errors.",
      suggestions: [
        "Check YAML indentation and syntax",
        "Verify Maestro command names and parameter formats",
        "Swipe: use 'start'/'end' (not 'from'/'to')",
        "Refer to Maestro docs for correct command schemas",
      ],
      severity: "error",
    },
  },
  // No device connected
  {
    regex: /(?:no devices? (?:found|connected|available)|device not found|unable to connect)/i,
    diagnostic: {
      category: "device",
      problem: "No device or emulator connected.",
      suggestions: [
        "Start an emulator: emulator -avd <name>",
        "For physical device: enable USB debugging and connect via USB",
        "Verify with: adb devices",
        "For iOS: xcrun simctl list devices booted",
      ],
      severity: "critical",
    },
  },
];

/**
 * Analyze Maestro flow output and error text to produce diagnostics.
 * Returns all matching patterns — multiple issues can coexist.
 */
export function analyzeFlowFailure(output: string, errors: string[]): FlowDiagnostic[] {
  const fullText = [output, ...errors].join("\n");
  const diagnostics: FlowDiagnostic[] = [];

  for (const pattern of PATTERNS) {
    if (pattern.regex.test(fullText)) {
      diagnostics.push({ ...pattern.diagnostic });
    }
  }

  // If nothing matched, return generic unknown diagnostic
  if (diagnostics.length === 0) {
    diagnostics.push({
      category: "unknown",
      problem: "Flow failed with unrecognized error pattern.",
      suggestions: [
        "Take a screenshot to see current device state",
        "Check Maestro debug output directory for logs",
        "Review flow YAML for correctness",
      ],
      severity: "error",
    });
  }

  return diagnostics;
}

/**
 * Parse the debug output directory path from Maestro CLI output.
 * Maestro prints: "==== Debug output (logs & screenshots) ====\n<path>"
 */
export function parseDebugOutputDir(output: string): string | null {
  // Look for the path after the debug output header
  const match = output.match(/Debug output.*?\n\s*(\S+\.maestro\/tests\/\S+)/i);
  if (match) return match[1];

  // Also try: just a path that looks like a maestro test dir
  const pathMatch = output.match(/(\/\S+\.maestro\/tests\/[\d_-]+)/);
  if (pathMatch) return pathMatch[1];

  return null;
}

/**
 * Format diagnostics into readable text for LLM consumption.
 */
export function formatDiagnostics(diagnostics: FlowDiagnostic[]): string {
  if (diagnostics.length === 0) return "";

  const lines: string[] = ["## Flow Failure Diagnostics\n"];

  for (const d of diagnostics) {
    const icon = d.severity === "critical" ? "🔴" : d.severity === "error" ? "🟠" : "🟡";
    lines.push(`${icon} **[${d.category.toUpperCase()}]** ${d.problem}`);
    lines.push("");
    lines.push("Suggested fixes:");
    for (const s of d.suggestions) {
      lines.push(`  - ${s}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
