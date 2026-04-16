# Plan: Soporte iOS Simulator para maestro-mcp

## Fase 1 — Lifecycle (prioridad máxima)

### Archivos nuevos
- `src/maestro/ios-simulator.ts` — clase IOSSimulator (wrappers xcrun simctl)
- `src/maestro/ios-types.ts` — SimulatorInfo, SimulatorRuntime, StatusBarOverrides, PushNotificationPayload

### Tools nuevos
| Tool | simctl | Para qué |
|------|--------|----------|
| `list_simulators` | `list devices --json` | Ver TODOS los sims (no solo booted) |
| `boot_simulator` | `boot <udid>` | Arrancar sim desde conversación |
| `shutdown_simulator` | `shutdown <udid>` | Apagar sim |

### Cambios en cli.ts
- `listDevices()` acepta `includeShutdown?: boolean`
- Detección de plataforma: UUID = iOS, emulator-NNNN = Android
- Refactor stopApp/takeScreenshot/installApp para detectar plataforma primero

---

## Fase 2 — Capacidades iOS-only

### Tools nuevos
| Tool | simctl | Para qué |
|------|--------|----------|
| `ios_open_url` | `openurl` | Deep links, universal links |
| `ios_set_permissions` | `privacy grant/revoke/reset` | Camera, location, photos, etc. |
| `ios_send_push` | `push` | Push notifications simuladas |
| `ios_override_status_bar` | `status_bar override/clear` | Screenshots limpios profesionales |

### Servicios de privacy soportados
all, calendar, contacts-limited, contacts, location, location-always, photos-add, photos, media-library, microphone, motion, reminders, siri

---

## Fase 3 — Avanzado

### Tools nuevos
| Tool | simctl | Para qué |
|------|--------|----------|
| `ios_set_location` | `location set/clear` | GPS simulado |
| `create_simulator` | `create` | Crear sims on-the-fly con runtime/devicetype |

### Cambios en yaml-generator.ts
- `adaptStepsForPlatform(steps, platform)` — ej: `back` → swipe desde borde izquierdo en iOS
- `hideKeyboard` → tap fuera del campo en iOS

### Cambios en cli.ts
- `findAppFromDerivedData(projectName)` — busca .app más reciente en DerivedData
- Soporte .ipa en installApp()

---

## Resumen archivos

| Archivo | Acción | Fase |
|---------|--------|------|
| `src/maestro/ios-simulator.ts` | NUEVO | 1 |
| `src/maestro/ios-types.ts` | NUEVO | 1 |
| `src/maestro/cli.ts` | MODIFICAR | 1, 3 |
| `src/maestro/types.ts` | MODIFICAR | 1 |
| `src/server.ts` | MODIFICAR (+8 tools) | 1, 2, 3 |
| `src/generators/yaml-generator.ts` | MODIFICAR | 3 |
| `src/__tests__/run.ts` | MODIFICAR | 1, 2, 3 |

## Notas
- Maestro YAML es platform-agnostic — misma sintaxis Android/iOS
- `back` no funciona en iOS (no hay botón físico) → swipe edge gesture
- Boot de simulator puede tardar 30-60s → incluir polling hasta "Booted"
- Status bar overrides persisten hasta clear o reboot
- Maestro usa `--udid` para target device específico
