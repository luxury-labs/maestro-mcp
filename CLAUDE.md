# CLAUDE.md

MCP server for mobile E2E testing via Maestro CLI. Auto-generates and runs YAML test flows on Android emulators, iOS simulators, and physical devices. Includes native code analysis (Swift/Kotlin/XML) to discover screens and suggest test flows. 32 tools total.

## Architecture

```
src/
  index.ts                  — Entry point, stdio transport, PATH auto-discovery
  server.ts                 — MCP server definition, all 32 tool registrations
  maestro/
    cli.ts                  — MaestroCli class: Maestro CLI wrapper, ADB/xcrun commands, screenshot capture
    ios-simulator.ts        — IOSSimulator class: xcrun simctl wrapper (lifecycle, capabilities, advanced)
    android-device.ts       — AndroidDevice class: ADB/avdmanager wrapper (URL opening, permissions, location, status bar demo mode, AVD management)
    ios-types.ts            — TypeScript types for simctl data (SimctlDevice, SimulatorInfo, StatusBarOverrides, etc.)
    types.ts                — Core types (FlowStep, FlowConfig, MaestroFlowResult, MaestroDebugReport, etc.)
  generators/
    yaml-generator.ts       — YAML generation from FlowStep arrays, template generators, adaptStepsForPlatform()
  analyzers/
    types.ts                — Types: ProjectPlatform, UIFramework, DiscoveredScreen, UIElement, ProjectScanResult
    project-scanner.ts      — Project scanner: platform detection, app ID extraction, file discovery (maxDepth 15)
    swift-analyzer.ts       — Swift analyzer: SwiftUI Views, UIKit VCs, buttons, text fields, accessibility IDs, navigation
    kotlin-analyzer.ts      — Kotlin analyzer: Compose, Activities, Fragments, layout XML, testTags, Intent navigation
  diagnostics/
    error-patterns.ts       — Regex-based failure pattern analysis (metro, element, crash, timeout, network, parse, device)
    debug-report-parser.ts  — Parses Maestro commands JSON debug artifacts, extracts UI hierarchy text
  utils/
    screenshot.ts           — Sharp-based screenshot processing (Display P3 -> sRGB JPEG, resize, validate)
    setup.ts                — Environment diagnostic (runSetup) and tool installer (installTool) for Maestro, Java, idb_companion
    temp-files.ts           — Temp directory management for flows, screenshots, tmp files
```

## Available MCP Tools (32)

### Setup Tools
- `setup` — Full environment diagnostic: checks Node.js, Maestro CLI, ADB, Android Emulator, Xcode/simctl, Java, idb_companion; lists connected devices; optional `autoInstall` to install missing tools
- `install_tool` — Install a specific tool: `maestro`, `java`, or `idb_companion`

### Core Tools
- `maestro_status` — Check Maestro CLI installation, version, connected devices
- `list_devices` — List all connected Android and iOS devices/emulators
- `device_info` — Get detailed info (OS version, platform) for a device ID
- `launch_app` — Launch app by package/bundle ID, optional clearState
- `stop_app` — Force stop a running app
- `install_app` — Install APK or .app on device/emulator
- `take_screenshot` — Capture device screen as base64 sRGB JPEG

### Interaction Tools
- `tap` — Tap by text, accessibility ID, or coordinates (supports long press)
- `input_text` — Type text into focused field
- `swipe` — Swipe in a direction or between two points
- `assert_visible` — Assert element is visible on screen
- `scroll_to` — Scroll until element becomes visible
- `press_back` — Press back button / navigate back

### Flow Tools
- `run_flow` — Execute an existing Maestro YAML flow file
- `generate_and_run_flow` — Auto-generate YAML from step arrays, run it, return results (primary autonomous testing tool)
- `generate_test` — Generate and run flows from templates: login, navigation, search, form
- `clean_flows` — Delete all temporary generated flow files

### Virtual Device Management Tools
- `list_virtual_devices` — List iOS simulators and Android emulators (filterable by platform, includes device types and system images for Android)
- `boot_device` — Boot a virtual device: UUID for iOS simulator, AVD name for Android emulator
- `shutdown_device` — Shutdown a virtual device (auto-detects platform from identifier)
- `create_device` — Create a new virtual device: iOS simulator (device type + runtime) or Android AVD (via avdmanager)
- `delete_device` — Delete a virtual device: iOS simulator by UDID or Android AVD by name

### Cross-Platform Device Tools
- `open_url` — Open deep link / universal link (cross-platform, auto-detects via deviceId)
- `set_permissions` — Grant, revoke, or reset privacy permissions (cross-platform: camera, location, photos, etc.)
- `send_push` — Send simulated push notification with custom payload (iOS only due to FCM limitation, unified API)
- `override_status_bar` — Override time, network, battery, carrier for clean screenshots (cross-platform: Android uses demo mode)
- `set_location` — Set simulated GPS coordinates or clear to reset (cross-platform: Android uses geo fix)

### Native Code Analysis Tools
- `scan_project` — Scan a mobile project directory to discover screens, UI elements, and navigation structure; analyzes Swift (SwiftUI/UIKit), Kotlin (Compose/XML); auto-detects platform (iOS, Android, React Native, Flutter) and extracts app IDs
- `analyze_source_file` — Analyze a single `.swift`, `.kt`, `.java`, or `.xml` layout file; extracts screens, UI elements (buttons, text fields, labels with text/IDs), navigation targets; returns raw source
- `suggest_flows` — Generate Maestro test flow suggestions (login, navigation, form fill) from project scan results; returns step arrays ready for `generate_and_run_flow`

## Native Code Analysis

The `src/analyzers/` module provides static analysis of mobile source code:
- **Swift**: Extracts SwiftUI `View` structs, UIKit `UIViewController` subclasses, buttons, text fields, labels, toggles, pickers, images, links, `.accessibilityIdentifier()`, `NavigationLink` destinations, `.sheet()` / `.fullScreenCover()` targets
- **Kotlin**: Extracts `@Composable` functions, `Activity` / `Fragment` subclasses, `Button`, `TextField`, `Text`, `Switch`, `LazyColumn/LazyRow`, `.testTag()`, `contentDescription`, `navController.navigate()` routes, `Intent`-based navigation
- **Layout XML**: Parses Android layout XML for `Button`, `EditText`, `TextView`, `ImageView`, `RecyclerView`, `Switch/CheckBox` with `android:id`, `android:text`, `android:hint`, `android:contentDescription`
- **Project scanner**: Detects platform from project files (`.xcodeproj`, `build.gradle`, `metro.config.js`, `pubspec.yaml`), extracts app IDs from `AndroidManifest.xml`, `Info.plist`, `app.json`

## Platform Detection and Adaptation

- `MaestroCli.detectPlatform(deviceId)` — UUID format (8-4-4-4-12) = iOS, `emulator-*` or other = Android
- `adaptStepsForPlatform(steps, platform)` — Automatically adapts flow steps for iOS:
  - `back` becomes swipe-from-left-edge gesture (iOS has no back button)
  - `hideKeyboard` becomes tap on neutral area (more reliable on iOS)

## Screenshot Pipeline

`take_screenshot` uses a multi-fallback strategy:
1. `adb exec-out screencap -p` (works on real devices and most emulators)
2. If result is <20KB (likely black/empty), falls back to `adb emu screenrecord screenshot`
3. If ADB unavailable, tries `xcrun simctl io screenshot` for iOS
4. All screenshots processed through Sharp: Display P3 -> sRGB, resize to max 1280px, JPEG quality 80, validated for JPEG magic bytes

## Failure Diagnostics

When a flow fails, `buildFailureResponse()` returns enriched content:
1. Compact JSON result (without base64 blobs)
2. Debug report from Maestro's commands JSON (completed steps, failed command, visible UI texts)
3. Failure screenshots as inline images for visual analysis
4. Pattern-based text diagnostics with category, problem description, and fix suggestions

## Build and Run

```bash
npm run build          # tsc -> dist/
npm run dev            # tsx watch for development
npm start              # node dist/index.js (production)
```

The `.mcp.json` config uses `node dist/index.js` (compiled output). Run `npm run build` after changes.

<!-- autoskills:start -->

Summary generated by `autoskills`. Check the full files inside `.claude/skills`.

## Node.js Backend Patterns

Build production-ready Node.js backend services with Express/Fastify, implementing middleware patterns, error handling, authentication, database integration, and API design best practices. Use when creating Node.js servers, REST APIs, GraphQL backends, or microservices architectures.

- `.claude/skills/nodejs-backend-patterns/SKILL.md`
- `.claude/skills/nodejs-backend-patterns/references/advanced-patterns.md`: Advanced patterns for dependency injection, database integration, authentication, caching, and API response formatting.

## Node.js Best Practices

Node.js development principles and decision-making. Framework selection, async patterns, security, and architecture. Teaches thinking, not copying.

- `.claude/skills/nodejs-best-practices/SKILL.md`

## TypeScript Advanced Types

Master TypeScript's advanced type system including generics, conditional types, mapped types, template literals, and utility types for building type-safe applications. Use when implementing complex type logic, creating reusable type utilities, or ensuring compile-time type safety in TypeScript pr...

- `.claude/skills/typescript-advanced-types/SKILL.md`

<!-- autoskills:end -->
