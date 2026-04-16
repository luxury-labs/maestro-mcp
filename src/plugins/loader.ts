import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  PluginContext,
  PluginConfig,
  PluginConfigEntry,
  MaestroPlugin,
  LoadPluginsResult,
} from "./types.js";

const CONFIG_DIR = ".maestro-mcp";
const CONFIG_FILE = "plugins.json";

/**
 * Read plugin config from `.maestro-mcp/plugins.json` in the current working
 * directory, if it exists.
 */
async function readConfig(cwd: string): Promise<PluginConfigEntry[]> {
  const configPath = path.join(cwd, CONFIG_DIR, CONFIG_FILE);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as PluginConfig;
    if (!Array.isArray(parsed.plugins)) {
      return [];
    }
    return parsed.plugins;
  } catch {
    // Config file doesn't exist or is invalid — that's fine
    return [];
  }
}

interface DiscoveredPackage {
  name: string;
  /** Absolute path to the package entry file */
  entryPath: string;
}

/**
 * Scan `node_modules` for packages whose `package.json` contains the keyword
 * `"maestro-mcp-plugin"`. Returns entries with resolved absolute entry paths
 * so we can import them regardless of the module resolution context.
 */
async function scanNodeModules(cwd: string): Promise<DiscoveredPackage[]> {
  const nmDir = path.join(cwd, "node_modules");
  const found: DiscoveredPackage[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(nmDir);
  } catch {
    return found;
  }

  for (const entry of entries) {
    // Skip hidden dirs
    if (entry.startsWith(".")) continue;

    if (entry.startsWith("@")) {
      // Scoped package — read sub-entries
      let scopedEntries: string[];
      try {
        scopedEntries = await fs.readdir(path.join(nmDir, entry));
      } catch {
        continue;
      }
      for (const sub of scopedEntries) {
        const pkgDir = path.join(nmDir, entry, sub);
        const pkgName = `${entry}/${sub}`;
        const entryPath = await getPluginEntry(pkgDir);
        if (entryPath) {
          found.push({ name: pkgName, entryPath });
        }
      }
    } else {
      const pkgDir = path.join(nmDir, entry);
      const entryPath = await getPluginEntry(pkgDir);
      if (entryPath) {
        found.push({ name: entry, entryPath });
      }
    }
  }

  return found;
}

/**
 * If the package at `pkgDir` has the `"maestro-mcp-plugin"` keyword, return
 * the absolute path to its entry file (from `main` or fallback to `index.js`).
 * Otherwise return `null`.
 */
async function getPluginEntry(pkgDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(pkgDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { keywords?: string[]; main?: string };
    if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("maestro-mcp-plugin")) {
      return null;
    }
    const mainFile = pkg.main ?? "index.js";
    return path.resolve(pkgDir, mainFile);
  } catch {
    return null;
  }
}

/**
 * Attempt to load a single plugin module and validate it has the expected
 * MaestroPlugin shape.
 */
async function importPlugin(specifier: string): Promise<MaestroPlugin> {
  // Dynamic import works for both npm packages and absolute file paths.
  // For file paths we need file:// URLs on all platforms.
  const importTarget = specifier.startsWith("/") || specifier.startsWith(".")
    ? pathToFileURL(path.resolve(specifier)).href
    : specifier;

  const mod = (await import(importTarget)) as Record<string, unknown>;
  const plugin = (mod.default ?? mod) as MaestroPlugin;

  if (!plugin || typeof plugin.name !== "string" || typeof plugin.register !== "function") {
    throw new Error(
      `Module "${specifier}" does not export a valid MaestroPlugin (must have name, version, register)`
    );
  }

  return plugin;
}

/**
 * Load and register all discovered plugins.
 *
 * Discovery order:
 *   1. Entries from `.maestro-mcp/plugins.json`
 *   2. npm packages in `node_modules` with keyword `"maestro-mcp-plugin"`
 *
 * Plugins from (2) are skipped if they were already listed in (1) (by package name).
 */
export async function loadPlugins(
  context: PluginContext,
  cwd: string = process.cwd()
): Promise<LoadPluginsResult> {
  const result: LoadPluginsResult = { loaded: [], errors: [] };

  // 1. Read explicit config
  const configEntries = await readConfig(cwd);

  // Track which packages we've already processed (from config)
  const processed = new Set<string>();

  // 2. Process config entries
  for (const entry of configEntries) {
    if (entry.enabled === false) continue;

    const specifier = entry.package ?? entry.path;
    if (!specifier) continue;

    // Resolve relative paths against cwd
    const resolvedSpecifier =
      entry.path && !path.isAbsolute(entry.path)
        ? path.resolve(cwd, entry.path)
        : specifier;

    if (entry.package) processed.add(entry.package);

    try {
      const plugin = await importPlugin(resolvedSpecifier);
      await plugin.register(context);
      result.loaded.push(plugin.name);
    } catch (err: unknown) {
      const error = err as { message?: string };
      result.errors.push({
        name: specifier,
        error: error.message ?? String(err),
      });
    }
  }

  // 3. Auto-discover from node_modules
  const discovered = await scanNodeModules(cwd);
  for (const { name: pkgName, entryPath } of discovered) {
    if (processed.has(pkgName)) continue;

    try {
      const plugin = await importPlugin(entryPath);
      await plugin.register(context);
      result.loaded.push(plugin.name);
    } catch (err: unknown) {
      const error = err as { message?: string };
      result.errors.push({
        name: pkgName,
        error: error.message ?? String(err),
      });
    }
  }

  return result;
}
