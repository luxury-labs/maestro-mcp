# Maestro MCP Plugins

Extend the Maestro MCP server with custom tools via plugins.

## Creating an npm plugin

1. Create a new package with the keyword `maestro-mcp-plugin` in `package.json`:

```json
{
  "name": "maestro-mcp-plugin-analytics",
  "version": "1.0.0",
  "keywords": ["maestro-mcp-plugin"],
  "type": "module",
  "main": "dist/index.js"
}
```

2. Export a default `MaestroPlugin` object:

```typescript
import type { MaestroPlugin, PluginContext } from "maestro-mcp/plugin";

const plugin: MaestroPlugin = {
  name: "analytics",
  version: "1.0.0",

  register(context: PluginContext): void {
    context.server.tool(
      "analytics_report",
      "Generate an analytics report",
      { appId: z.string() },
      async ({ appId }) => {
        // Use context.maestro, context.iosSim, context.androidDev as needed
        return {
          content: [{ type: "text", text: `Report for ${appId}` }],
        };
      }
    );
  },
};

export default plugin;
```

3. Install it in the project that uses maestro-mcp:

```bash
npm install maestro-mcp-plugin-analytics
```

The plugin is auto-discovered via the `maestro-mcp-plugin` keyword in `node_modules`.

## Creating a local plugin

1. Create a `.js` or `.ts` file that exports a `MaestroPlugin`:

```typescript
// custom-plugins/my-plugin.ts
import type { MaestroPlugin } from "maestro-mcp/plugin";

const plugin: MaestroPlugin = {
  name: "my-custom-plugin",
  version: "0.1.0",
  register(context) {
    context.server.tool("my_tool", "My custom tool", {}, async () => ({
      content: [{ type: "text", text: "Hello!" }],
    }));
  },
};

export default plugin;
```

2. Register it in `.maestro-mcp/plugins.json`:

```json
{
  "plugins": [
    { "path": "./custom-plugins/my-plugin.js", "enabled": true }
  ]
}
```

## Configuration file

Create `.maestro-mcp/plugins.json` in your project root:

```json
{
  "plugins": [
    { "package": "maestro-mcp-plugin-firebase", "enabled": true },
    { "path": "./custom-plugins/my-plugin.js", "enabled": true },
    { "package": "maestro-mcp-plugin-disabled", "enabled": false }
  ]
}
```

- `package` — npm package name (resolved from `node_modules`)
- `path` — local file path (relative to project root, or absolute)
- `enabled` — set to `false` to skip loading (default: `true`)

## Plugin API reference

### PluginContext

| Property     | Type            | Description                          |
|------------- |---------------- |------------------------------------- |
| `server`     | `McpServer`     | The MCP server instance              |
| `maestro`    | `MaestroCli`    | Maestro CLI wrapper                  |
| `iosSim`     | `IOSSimulator`  | iOS simulator controller             |
| `androidDev` | `AndroidDevice` | Android device/emulator controller   |

### MaestroPlugin

| Property   | Type                                           | Description                          |
|----------- |----------------------------------------------- |------------------------------------- |
| `name`     | `string`                                       | Plugin name (for logging/errors)     |
| `version`  | `string`                                       | Plugin version                       |
| `register` | `(context: PluginContext) => void \| Promise<void>` | Called once during server startup |

### Importing types

```typescript
import type { MaestroPlugin, PluginContext } from "maestro-mcp/plugin";
```
