# maestro-mcp

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-blueviolet)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**Let your AI assistant drive real phones.** An MCP server that gives any AI assistant full control over Android emulators and iOS simulators through [Maestro CLI](https://maestro.mobile.dev/) -- generating, running, and diagnosing mobile E2E tests from natural language.

---

## What is this?

maestro-mcp turns your AI assistant into a mobile QA engineer. Instead of manually writing Maestro YAML files, launching simulators, and debugging test failures, you describe what you want in plain English and the AI handles everything: tapping buttons, filling forms, asserting screens, taking screenshots, and reporting results.

The server exposes 32 MCP tools that cover the entire mobile testing lifecycle. It can scan your native codebase (Swift, Kotlin, XML layouts) to discover screens and UI elements, generate test flows based on what it finds, execute those flows on real devices or emulators, and when something fails, return annotated screenshots with diagnostic analysis so the AI can self-correct and retry.

This works with **any MCP-compatible client** -- Claude Code, Claude Desktop, Cursor, Windsurf, or any other tool that speaks the [Model Context Protocol](https://modelcontextprotocol.io). If your AI assistant supports MCP, it can test your mobile app.

---

## Quick Start

### 1. Install and build

```bash
git clone https://github.com/your-org/maestro-mcp.git
cd maestro-mcp
npm install
npm run build
```

### 2. Configure your MCP client

Add to your `.mcp.json` (Claude Code) or equivalent MCP configuration:

```json
{
  "mcpServers": {
    "maestro-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/maestro-mcp/dist/index.js"]
    }
  }
}
```

### 3. Verify the environment

Ask your AI assistant:

> "Run the setup tool to check if everything is installed for mobile testing."

The `setup` tool checks Node.js, Maestro CLI, Android SDK, Xcode/simctl, Java, and idb_companion. It lists connected devices and tells you exactly what is missing. If anything is missing, you can say:

> "Install Maestro CLI for me."

The `install_tool` tool auto-installs Maestro, Java (via Homebrew), and idb_companion.

---

## Setup Tool

Before running any tests, use the `setup` tool. It performs a full environment diagnostic:

| Check | Required? | Auto-installable? |
|---|---|---|
| Node.js | Yes | No |
| Maestro CLI | Yes | Yes -- `install_tool` with `tool: "maestro"` |
| Android SDK (ADB) | For Android | No -- install via Android Studio |
| Android Emulator | For Android | No -- install via SDK Manager |
| Xcode (simctl) | For iOS | No -- install from App Store |
| Java Runtime | Yes (Maestro dependency) | Yes -- `install_tool` with `tool: "java"` |
| idb_companion | Optional (faster iOS) | Yes -- `install_tool` with `tool: "idb_companion"` |

Pass `autoInstall: true` to `setup` to install all auto-installable tools in one shot.

---

## Features Overview

### Environment Setup

| Tool | Description |
|---|---|
| `setup` | Full environment diagnostic -- checks all dependencies, lists devices, shows install commands |
| `install_tool` | Auto-install Maestro CLI, Java, or idb_companion |

### Device Management

| Tool | Description |
|---|---|
| `maestro_status` | Check Maestro installation, version, and connected devices |
| `list_devices` | List all connected Android devices and iOS simulators |
| `device_info` | Get detailed info (OS version, platform, emulator status) for a device |
| `launch_app` | Launch an app by package/bundle ID, optionally clearing state first |
| `stop_app` | Force stop a running app |
| `install_app` | Install an APK or .app file on a device/emulator |
| `take_screenshot` | Capture the current screen as base64 JPEG (sRGB, max 1280px) |

### UI Interaction

| Tool | Description |
|---|---|
| `tap` | Tap on an element by text, accessibility ID, coordinates, or index |
| `input_text` | Type text into the currently focused field |
| `swipe` | Swipe in a direction (UP/DOWN/LEFT/RIGHT) or between two points |
| `assert_visible` | Assert that an element with given text or ID is visible |
| `scroll_to` | Scroll in a direction until a specific element becomes visible |
| `press_back` | Press the back button (Android) or navigate back |

### Test Flows

| Tool | Description |
|---|---|
| `run_flow` | Execute an existing Maestro YAML file by path |
| `generate_and_run_flow` | Build a YAML flow from a step array, execute it, return results. **Primary tool for autonomous testing.** |
| `generate_test` | Generate and run a test from a template: `login`, `navigation`, `search`, or `form` |
| `clean_flows` | Delete all temporary generated YAML flow files |

### Virtual Device Management

| Tool | Description |
|---|---|
| `list_virtual_devices` | List iOS simulators and Android emulators (filterable by platform, includes device types and system images for Android) |
| `boot_device` | Boot a virtual device -- UUID for iOS simulator, AVD name for Android emulator |
| `shutdown_device` | Shutdown a virtual device (auto-detects platform from identifier) |
| `create_device` | Create a new virtual device -- iOS simulator (device type + runtime) or Android AVD (via avdmanager) |
| `delete_device` | Delete a virtual device -- iOS simulator by UDID or Android AVD by name |

### Cross-Platform Device Tools

| Tool | Description |
|---|---|
| `open_url` | Open a deep link or universal link (cross-platform, auto-detects via deviceId) |
| `set_permissions` | Grant, revoke, or reset privacy permissions (cross-platform -- camera, location, photos, microphone, etc.) |
| `send_push` | Send a simulated push notification with custom APNs payload (iOS only due to FCM limitation, unified API) |
| `override_status_bar` | Override status bar (time, network, battery, carrier) for clean screenshots (cross-platform -- Android uses demo mode) |
| `set_location` | Set or clear simulated GPS coordinates (cross-platform -- Android uses geo fix) |

### Code Analysis

| Tool | Description |
|---|---|
| `scan_project` | Scan a mobile project directory to discover screens, UI elements, and navigation structure |
| `analyze_source_file` | Analyze a single native source file -- returns extracted screens, elements, and raw source |
| `suggest_flows` | Scan a project and generate ready-to-run test flow suggestions based on discovered UI |

---

## Usage Examples

### Scan your project and suggest tests

> "Scan my iOS project at ~/Projects/MyApp and suggest what tests I should write."

The AI calls `scan_project` to discover screens and UI elements, then `suggest_flows` to generate test suggestions. Each suggestion includes a name, description, and a complete step array ready to pass to `generate_and_run_flow`. The AI can then ask:

> "Run the login-LoginView test you suggested."

And it calls `generate_and_run_flow` with the suggested steps.

### Take a screenshot and describe what you see

> "Take a screenshot of the emulator and tell me what screen the app is on."

The AI calls `take_screenshot`, receives the image as base64 JPEG, and visually describes the current screen state. This is useful for orientation, debugging, and verifying test results.

### Log in and navigate to settings

> "Open com.example.app, log in with test@mail.com / secret123, then navigate to the Settings screen."

The AI calls `generate_and_run_flow` with steps:

```json
{
  "appId": "com.example.app",
  "name": "login-and-settings",
  "steps": [
    { "action": "launchApp", "params": { "appId": "com.example.app" } },
    { "action": "waitForAnimationToEnd", "params": {} },
    { "action": "tapOn", "params": { "text": "Email" } },
    { "action": "inputText", "params": { "text": "test@mail.com" } },
    { "action": "tapOn", "params": { "text": "Password" } },
    { "action": "inputText", "params": { "text": "secret123" } },
    { "action": "hideKeyboard", "params": {} },
    { "action": "tapOn", "params": { "text": "Log in" } },
    { "action": "waitForAnimationToEnd", "params": {} },
    { "action": "tapOn", "params": { "text": "Settings" } },
    { "action": "assertVisible", "params": { "text": "Settings" } },
    { "action": "takeScreenshot", "params": { "name": "settings-screen" } }
  ]
}
```

### Set up a device for App Store screenshots

> "Boot the iPhone 16 Pro simulator, set the status bar to 9:41 with full signal and 100% battery, then take a screenshot."

The AI calls `boot_device`, then `override_status_bar`:

```json
{
  "deviceId": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  "time": "9:41",
  "dataNetwork": "wifi",
  "wifiMode": "active",
  "wifiBars": 3,
  "cellularMode": "active",
  "cellularBars": 4,
  "batteryState": "charged",
  "batteryLevel": 100,
  "operatorName": "Carrier"
}
```

Then `take_screenshot`, and finally `override_status_bar` with `clear: true` to reset.

### Grant camera permission and test photo feature

> "Grant camera permission to com.example.app on the booted device, then launch the app and tap the Take Photo button."

The AI calls `set_permissions` with `action: "grant"`, `service: "camera"`, `bundleId: "com.example.app"`, then `generate_and_run_flow` with the tap steps.

### Analyze Swift code and generate a login test

> "Analyze the file LoginView.swift in my project and generate a login test based on what you find."

The AI calls `analyze_source_file` to extract UI elements (text fields, buttons, labels, accessibility IDs), then uses that information to build a precise `generate_and_run_flow` call targeting the exact placeholder texts and button labels found in the source code.

---

## Platform Support

| Feature | Android | iOS |
|---|---|---|
| Device listing | ADB devices | xcrun simctl |
| App install | APK via ADB | .app via simctl |
| App launch/stop | Maestro + ADB | Maestro + simctl |
| Screenshots | ADB screencap + emulator fallback | simctl io screenshot |
| Test flow execution | Maestro CLI | Maestro CLI |
| Platform step adaptation | Native | `back` becomes edge swipe, `hideKeyboard` becomes tap |
| Deep links | `open_url` via ADB | `open_url` via simctl |
| Permissions | `set_permissions` via ADB | `set_permissions` via simctl |
| Push notifications | -- | `send_push` with custom APNs payload |
| Status bar override | `override_status_bar` via demo mode | `override_status_bar` via simctl |
| GPS location | `set_location` via geo fix | `set_location` via simctl |
| Virtual device lifecycle | `boot_device`, `shutdown_device`, `create_device`, `delete_device` via avdmanager | `boot_device`, `shutdown_device`, `create_device`, `delete_device` via simctl |
| Code analysis | Kotlin, Jetpack Compose, XML layouts | Swift, SwiftUI, UIKit |

**Platform auto-detection:** Device IDs matching the UUID format (8-4-4-4-12) are identified as iOS; everything else is Android. The `generate_and_run_flow` tool automatically adapts steps for the target platform.

---

## Native Code Analysis

The `scan_project` and `analyze_source_file` tools parse native source code to extract testable UI structure.

### Supported Platforms

| Platform | Frameworks | What it detects |
|---|---|---|
| **iOS** | SwiftUI, UIKit, Storyboard | `struct SomeName: View`, `UIViewController` subclasses, `.xcodeproj`/`.xcworkspace` |
| **Android** | Jetpack Compose, XML layouts | `@Composable` functions, `Activity`/`Fragment` subclasses, `build.gradle` |
| **React Native** | React Native | `metro.config.js`, `app.json`, `index.js` (platform detection only) |
| **Flutter** | Flutter | `pubspec.yaml` (platform detection only) |

### Extracted UI Elements

| Element | SwiftUI | UIKit | Jetpack Compose | Android XML |
|---|---|---|---|---|
| Buttons | `Button("text")` | `.setTitle("text", ...)` | `Button { Text("text") }` | `<Button android:text="...">` |
| Text fields | `TextField("placeholder")`, `SecureField(...)` | `.placeholder = "..."` | `TextField(label = { Text("...") })` | `<EditText android:hint="...">` |
| Labels | `Text("content")` | `.text = "..."` | `Text("content")` | `<TextView android:text="...">` |
| Images | `Image("name")` | -- | `Image(contentDescription = "...")` | `<ImageView android:contentDescription="...">` |
| Lists | `List { }` | `UITableView` / `UICollectionView` | `LazyColumn` / `LazyRow` | `<RecyclerView>` / `<ListView>` |
| Toggles | `Toggle("label")` | -- | `Switch()` / `Checkbox()` | `<Switch>` / `<CheckBox>` |
| Accessibility IDs | `.accessibilityIdentifier("id")` | `.accessibilityIdentifier = "id"` | `.testTag("tag")`, `contentDescription` | `android:id="@+id/..."` |

### Extracted Navigation

| Pattern | SwiftUI | UIKit | Compose | Android XML |
|---|---|---|---|---|
| Push/present | `NavigationLink(destination: ...)` | `pushViewController(...)`, `present(...)` | `navController.navigate("route")` | `Intent(ctx, Activity::class.java)` |
| Sheet/modal | `.sheet { }`, `.fullScreenCover { }` | -- | -- | -- |
| Segue | -- | `performSegue(withIdentifier: ...)` | -- | `navigate(R.id.action_xxx)` |

The `suggest_flows` tool uses all of this to automatically generate login flows, navigation tests, and form-fill tests with the correct field names, button labels, and accessibility identifiers from your source code.

---

## Architecture

```
src/
  index.ts                  # Entry point -- stdio transport, PATH auto-setup
  server.ts                 # MCP server -- 32 tool registrations, failure response builder
  maestro/
    cli.ts                  # MaestroCli -- ADB, xcrun, Maestro flow execution, screenshots
    ios-simulator.ts        # IOSSimulator -- full xcrun simctl wrapper
    android-device.ts       # AndroidDevice -- ADB/avdmanager wrapper (URL, permissions, location, status bar, AVD management)
    types.ts                # FlowStep, FlowConfig, MaestroFlowResult, MaestroDebugReport
    ios-types.ts            # SimctlDevice, StatusBarOverrides, PushPayload, PrivacyService
  analyzers/
    project-scanner.ts      # Platform detection, file discovery, project scanning
    swift-analyzer.ts       # SwiftUI View + UIKit ViewController extraction
    kotlin-analyzer.ts      # Composable, Activity, Fragment, XML layout extraction
    types.ts                # DiscoveredScreen, UIElement, ProjectScanResult
  generators/
    yaml-generator.ts       # Step-to-YAML conversion, platform adaptation, templates
  diagnostics/
    error-patterns.ts       # Pattern-based failure analysis (7 categories)
    debug-report-parser.ts  # Maestro commands JSON parser -- UI hierarchy + visible text
  utils/
    screenshot.ts           # Display P3 to sRGB, resize, JPEG encode via sharp
    setup.ts                # Environment diagnostic + auto-installer
    temp-files.ts           # Temp directory management
```

**Data flow:**

```
AI calls tool --> server.ts builds FlowStep[]
  --> yaml-generator.ts converts to Maestro YAML (with platform adaptation)
  --> cli.ts executes via `maestro test`
  --> On failure:
      --> error-patterns.ts matches output against known patterns
      --> debug-report-parser.ts parses Maestro's commands JSON
      --> cli.ts collects debug screenshots + takes live screenshot
  --> Response includes: result, diagnostics, screenshots, visible UI text
  --> AI can visually analyze failure screenshots and self-correct
```

---

## Screenshot Pipeline

Screenshots pass through a multi-step pipeline before being returned to the AI:

1. **Capture** -- tries `adb exec-out screencap -p` first. If the result is suspiciously small (<20KB, indicating a black/empty frame), falls back to `adb emu screenrecord screenshot` (emulator console capture). If ADB is unavailable, uses `xcrun simctl io screenshot` for iOS.
2. **Resize** -- longest side capped at 1280px (keeps API payload reasonable).
3. **Remove alpha** -- strips the transparency channel.
4. **Convert to sRGB** -- fixes the Display P3 color profile from iOS simulators that causes 400 errors with some AI APIs.
5. **JPEG encode** -- 80% quality with MozJPEG for smaller payloads.
6. **Validate** -- checks JPEG magic bytes and minimum file size.

The pipeline uses [sharp](https://sharp.pixelplumbing.com/) for image processing.

---

## Failure Diagnostics

When a flow fails, the server returns enriched error responses with multiple layers of analysis:

### Pattern Matching

The output is analyzed against 7 known failure categories:

| Category | Trigger | Example |
|---|---|---|
| `metro` | Metro bundler not connected | "Unable to load script" in React Native dev builds |
| `element` | Element not found on screen | Tap/assert targeting text that doesn't exist |
| `app_crash` | Application crashed or ANR | "FATAL EXCEPTION" or "has stopped" |
| `timeout` | Operation timed out | Waiting for element or animation too long |
| `network` | Network connectivity issue | `ECONNREFUSED`, "Unable to resolve host" |
| `parse` | YAML syntax/schema error | Malformed flow file |
| `device` | No device connected | "no devices found" |

Each diagnostic includes the problem description, severity level, and actionable fix suggestions.

### Debug Report

Maestro generates a `commands-*.json` artifact on failure. The server parses it to extract:

- Which steps completed successfully (shown as a chain: `launchApp --> tapOn: "Email" --> inputText`)
- Which step failed, with the exact error message and duration
- All visible text on screen at the moment of failure (extracted from the UI hierarchy)

### Failure Screenshots

Up to 5 screenshots from Maestro's debug directory, plus a live screenshot of the current device state, are returned as base64 images. The AI can visually analyze these to understand what went wrong.

---

## Configuration

### MCP Client Configuration

<details>
<summary><strong>Claude Code (.mcp.json)</strong></summary>

```json
{
  "mcpServers": {
    "maestro-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/maestro-mcp/dist/index.js"]
    }
  }
}
```

Place in your project root as `.mcp.json` or globally at `~/.claude/.mcp.json`.

</details>

<details>
<summary><strong>Claude Desktop (claude_desktop_config.json)</strong></summary>

```json
{
  "mcpServers": {
    "maestro-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/maestro-mcp/dist/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>Any MCP-compatible client</strong></summary>

maestro-mcp uses stdio transport. Configure your client to spawn:

```
node /absolute/path/to/maestro-mcp/dist/index.js
```

The server communicates via JSON-RPC over stdin/stdout.

</details>

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANDROID_HOME` | `~/Library/Android/sdk` | Android SDK root directory |
| `ADB_BIN` | Auto-detected from `ANDROID_HOME` | Explicit path to `adb` binary |
| `MAESTRO_BIN` | `maestro` (resolved from PATH) | Explicit path to Maestro CLI binary |

The server automatically appends `~/.maestro/bin`, `$ANDROID_HOME/platform-tools`, and `$ANDROID_HOME/emulator` to `PATH` at startup.

---

## Known Issues & Tips

### Emulator screenshot returns black image

Some Android emulators return a black/empty PNG from `adb exec-out screencap -p`. The server detects this (file size <20KB) and falls back to `adb emu screenrecord screenshot`, which captures through the emulator console. This fallback only works on emulators, not physical devices.

### `clearState` breaks React Native dev builds

Using `clearState: true` wipes the app's data directory. For React Native / Expo apps in dev mode, this clears Metro bundler connection settings, causing "Unable to load script" errors. After clearing state:

- Rebuild the dev bundle, or
- Run `adb reverse tcp:8081 tcp:8081` again, or
- Use a release build instead

### iOS `back` navigation

Maestro's `back` command is Android-only. When using `generate_and_run_flow` with an iOS device ID, steps are auto-adapted (`back` becomes an edge swipe from 0%,50% to 80%,50%). The `press_back` tool now auto-adapts for iOS by using a swipe-from-edge gesture instead of the raw `back` command.

### Dark mode screenshots

Screenshots capture the current display state, including dark mode. If your AI is confused by the color scheme, mention that the device is in dark mode. You can also toggle appearance via the emulator settings before taking screenshots.

### Emulator DNS / network issues

Android emulators use `10.0.2.2` to reach the host machine's localhost. If your app connects to a local backend, make sure the API URL uses `10.0.2.2` instead of `localhost` or `127.0.0.1` in the emulator environment. Alternatively, run `adb reverse tcp:<port> tcp:<port>` to forward ports.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and add tests if applicable
4. Build and verify: `npm run build`
5. Submit a pull request

The project uses TypeScript 6.0 with ES modules. Run `npm run dev` for watch mode during development.

---

## Acknowledgments

This project was born from the need to automate mobile testing workflows using AI assistants. It wraps [Maestro CLI](https://github.com/mobile-dev-inc/maestro) — an excellent open-source mobile testing framework developed by [mobile.dev](https://mobile.dev/) and licensed under Apache 2.0.

**Important:** maestro-mcp is an independent community project. We do not own, claim ownership of, or represent the Maestro brand in any way. "Maestro" in our project name refers solely to the CLI tool we integrate with. All credit for Maestro CLI goes to the mobile.dev team.

If the Maestro team has any concerns about the use of their name, we are happy to rename this project. Reach out at jmartinez@autored.cl.

## License

MIT — [Luxury Labs](https://github.com/luxury-labs)
