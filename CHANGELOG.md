# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`AndroidDevice` class** (`src/maestro/android-device.ts`) — Android equivalents for URL opening, permissions, location, status bar demo mode, and AVD management via ADB and avdmanager CLI
- **Android AVD creation/deletion** via `avdmanager` CLI, exposed through `create_device` and `delete_device` tools
- **`list_virtual_devices`** now returns Android device types and system images alongside simulator/emulator listings
- **`setup` tool** — full environment diagnostic (Node.js, Maestro CLI, ADB, Android Emulator, Xcode/simctl, Java, idb_companion) with connected device listing; supports `autoInstall` to auto-install missing tools
- **`install_tool` tool** — install a specific tool required by maestro-mcp; supported: `maestro`, `java`, `idb_companion`
- **Native code analysis module** (`src/analyzers/`):
  - `scan_project` tool — scans mobile project directories, auto-detects platform/framework (iOS, Android, React Native, Flutter), discovers screens and UI elements, extracts app IDs from config files
  - `analyze_source_file` tool — analyzes individual `.swift`/`.kt`/`.java`/`.xml` layout files, extracts screens, UI elements (buttons, text fields, labels with text/IDs), and navigation targets; returns raw source code for deeper analysis
  - `suggest_flows` tool — generates Maestro test flow suggestions (login, navigation, form) from code analysis results, with steps ready to pass to `generate_and_run_flow`
  - Swift analyzer: SwiftUI Views, UIKit ViewControllers, buttons, text fields, labels, toggles, pickers, navigation links, sheets, accessibility identifiers
  - Kotlin analyzer: Jetpack Compose Composables, Activities, Fragments, layout XML, buttons, text fields, labels, switches, testTags, navigation routes, Intent-based navigation
  - Project scanner: auto-detects iOS/Android/React Native/Flutter from project files, extracts app IDs from `app.json`, `AndroidManifest.xml`, `Info.plist`
- **Cross-platform device support** via `IOSSimulator` (xcrun simctl) and `AndroidDevice` (ADB/avdmanager):
  - Lifecycle: `list_virtual_devices`, `boot_device`, `shutdown_device`
  - Capabilities: `open_url`, `set_permissions`, `send_push`, `override_status_bar`
  - Advanced: `set_location`, `create_device`, `delete_device`
- **Platform auto-detection** from device ID: UUID format = iOS, `emulator-*` = Android (`MaestroCli.detectPlatform()`)
- **`adaptStepsForPlatform()`** in YAML generator: automatically translates platform-specific actions
  - `back` on iOS becomes a swipe-from-left-edge gesture
  - `hideKeyboard` on iOS becomes a tap on a neutral screen area
- **Failure diagnostics system** (`src/diagnostics/`)
  - `error-patterns.ts`: regex-based pattern matching for common failure categories (Metro bundler, element not found, app crash, timeout, network, YAML parse errors, no device)
  - `debug-report-parser.ts`: parses Maestro's `commands-*.json` debug artifacts to extract completed steps, the failed command, error message, and visible UI text at time of failure
  - `buildFailureResponse()` in server: enriched MCP responses with JSON result, debug report, failure screenshot images, and text diagnostics
- **Sharp-based screenshot processing** (`readScreenshotSafe`): converts Display P3 color profile to sRGB JPEG, resizes to max 1280px, validates JPEG magic bytes — fixes Anthropic API 400 errors from P3 PNGs
- iOS type definitions (`src/maestro/ios-types.ts`): `SimctlDevice`, `SimulatorInfo`, `SimctlRuntime`, `BootOptions`, `PrivacyService`, `PrivacyAction`, `StatusBarOverrides`, `PushPayload`

### Changed

- **Unified 8 platform-specific tools into 5 cross-platform tools:** `ios_open_url` / `ios_set_permissions` / `ios_send_push` / `ios_override_status_bar` / `ios_set_location` merged into `open_url`, `set_permissions`, `send_push`, `override_status_bar`, `set_location` (auto-detect platform via deviceId)
- **Unified 6 lifecycle tools into 3:** `list_simulators` + `list_emulators` merged into `list_virtual_devices`; `boot_simulator` + `boot_emulator` merged into `boot_device`; `shutdown_simulator` + `shutdown_emulator` merged into `shutdown_device`
- **`create_simulator` / `delete_simulator` renamed to `create_device` / `delete_device`** with added Android avdmanager support
- Tool count reduced from 36 to 32 by merging platform-specific duplicates
- `.mcp.json` now uses compiled `node dist/index.js` instead of `tsx` for production use

### Fixed

- **`press_back` now auto-adapts for iOS** — uses swipe-from-edge gesture instead of failing with raw `back` command
- **`stop_app` detects platform first** instead of relying on try/catch chain
- **`install_app` supports `.ipa` files** for iOS device installation
- **`findFiles` maxDepth increased to 15** (was 8): too shallow for deep Android package paths like `com/company/app/features/auth/ui/`
- **Screenshot black/empty image fallback**: when `adb exec-out screencap -p` returns a suspiciously small file (<20KB, typically a black image), the system now falls back to `adb emu screenrecord screenshot` for emulators before returning the result

## [0.1.0] - 2025-07-01

### Added

- Initial MCP server implementation (`@modelcontextprotocol/sdk` with stdio transport)
- **Core tools** for mobile E2E testing via Maestro CLI:
  - `maestro_status` — check Maestro CLI installation, version, and connected devices
  - `list_devices` — list all connected Android and iOS devices/emulators
  - `device_info` — get detailed info about a specific device (OS version, platform)
  - `launch_app` — launch a mobile app by package/bundle ID with optional state clearing
  - `stop_app` — force stop a running app
  - `install_app` — install APK or .app on a device/emulator
  - `take_screenshot` — capture device screen as base64 JPEG image
  - `tap` — tap on an element by text, ID, or coordinates (with long press support)
  - `input_text` — type text into the focused field
  - `swipe` — swipe in a direction or between two points
  - `assert_visible` — assert that an element is visible on screen
  - `scroll_to` — scroll until an element becomes visible
  - `press_back` — press the back button / navigate back
  - `run_flow` — run a Maestro flow from an existing YAML file path
  - `generate_and_run_flow` — auto-generate a Maestro YAML flow from step arrays, execute it, and return results
  - `generate_test` — auto-generate complete test flows from templates (login, navigation, search, form)
  - `clean_flows` — delete all temporary generated flow files
- YAML generator (`src/generators/yaml-generator.ts`) with support for 24 Maestro actions: `launchApp`, `stopApp`, `clearState`, `tapOn`, `inputText`, `eraseText`, `pasteText`, `assertVisible`, `assertNotVisible`, `waitUntilVisible`, `scrollUntilVisible`, `scroll`, `swipe`, `back`, `hideKeyboard`, `waitForAnimationToEnd`, `takeScreenshot`, `pressKey`, `openLink`, `clearKeychain`, `setLocation`, `repeat`, `evalScript`, `runFlow`
- Template-based test generators: `generateLoginFlow`, `generateNavigationFlow`, `generateScrollSearchFlow`, `generateFormFlow`
- Temporary flow file management: auto-create, execute, and clean up `.yaml` flows
- Entry point with PATH auto-discovery for Android SDK tools and Maestro CLI
- TypeScript project with ESM modules, `sharp` for image processing, `zod` for input validation

[Unreleased]: https://github.com/user/maestro-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/user/maestro-mcp/releases/tag/v0.1.0
