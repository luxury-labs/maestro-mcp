import fs from "node:fs/promises";
import path from "node:path";

/**
 * Parse Android strings.xml content into a Map<key, text>.
 * Handles <string name="key">value</string>.
 * Skips <string-array> and <plurals> (or returns first item if present).
 */
export function parseStringsXml(content: string): Map<string, string> {
  const map = new Map<string, string>();

  // Match <string name="key">value</string> — handles multiline values
  const stringRegex = /<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = stringRegex.exec(content)) !== null) {
    const key = m[1];
    // Unescape basic XML entities and Android escape sequences
    const rawValue = m[2]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"');
    map.set(key, rawValue.trim());
  }

  // Optionally extract first item from string-array
  const arrayRegex = /<string-array\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string-array>/g;
  while ((m = arrayRegex.exec(content)) !== null) {
    const key = m[1];
    const itemMatch = m[2].match(/<item>([\s\S]*?)<\/item>/);
    if (itemMatch) {
      map.set(key, itemMatch[1].trim());
    }
  }

  return map;
}

/**
 * Parse iOS Localizable.strings content into a Map<key, text>.
 * Format: "key" = "value";
 */
export function parseLocalizableStrings(content: string): Map<string, string> {
  const map = new Map<string, string>();

  // Match "key" = "value";
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const key = unescapeIosString(m[1]);
    const value = unescapeIosString(m[2]);
    map.set(key, value);
  }

  return map;
}

/** Unescape iOS string escape sequences */
function unescapeIosString(s: string): string {
  // Process character-by-character to handle \\ before \n, \t, etc.
  let result = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "\\") { result += "\\"; i++; }
      else if (next === "n") { result += "\n"; i++; }
      else if (next === "t") { result += "\t"; i++; }
      else if (next === '"') { result += '"'; i++; }
      else { result += s[i]; }
    } else {
      result += s[i];
    }
  }
  return result;
}

/**
 * Recursively find files matching a predicate under a directory.
 */
async function findFilesMatching(
  dir: string,
  predicate: (filePath: string, name: string) => boolean,
  maxDepth = 15,
  ignore = ["node_modules", ".build", "build", "Pods", ".gradle", "DerivedData", ".git"]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (predicate(fullPath, entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir, 0);
  return results;
}

/**
 * Build a string map from Android res/values/strings.xml files.
 * Searches for strings.xml under any res/values* directory.
 * Default locale (res/values/) takes lowest priority; localized overrides win.
 */
export async function buildAndroidStringMap(projectPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const stringFiles = await findFilesMatching(
    projectPath,
    (filePath, name) => name === "strings.xml" && /[/\\]res[/\\]values/.test(filePath)
  );

  // Sort so default (res/values/strings.xml) is processed first, then locale variants override
  stringFiles.sort((a, b) => {
    const aIsDefault = /[/\\]res[/\\]values[/\\]/.test(a) && !/[/\\]res[/\\]values-/.test(a);
    const bIsDefault = /[/\\]res[/\\]values[/\\]/.test(b) && !/[/\\]res[/\\]values-/.test(b);
    if (aIsDefault && !bIsDefault) return -1;
    if (!aIsDefault && bIsDefault) return 1;
    return 0;
  });

  for (const file of stringFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const parsed = parseStringsXml(content);
      // Default values go in first; locale-specific files only override if not already set
      // Actually, defaults should be the fallback, so we set defaults first
      const isDefault = /[/\\]res[/\\]values[/\\]/.test(file) && !/[/\\]res[/\\]values-/.test(file);
      for (const [key, value] of parsed) {
        if (isDefault) {
          // Only set if not already overridden by a locale
          if (!map.has(key)) {
            map.set(key, value);
          }
        } else {
          // Locale-specific overrides default
          map.set(key, value);
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return map;
}

/**
 * Build a string map from iOS Localizable.strings files.
 * Searches for Localizable.strings or Localizable.stringsdict files.
 */
export async function buildIosStringMap(projectPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const stringFiles = await findFilesMatching(
    projectPath,
    (_filePath, name) => name === "Localizable.strings"
  );

  // Sort: Base.lproj first (fallback), then locale-specific
  stringFiles.sort((a, b) => {
    const aIsBase = a.includes("Base.lproj") || a.includes("en.lproj");
    const bIsBase = b.includes("Base.lproj") || b.includes("en.lproj");
    if (aIsBase && !bIsBase) return -1;
    if (!aIsBase && bIsBase) return 1;
    return 0;
  });

  for (const file of stringFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const parsed = parseLocalizableStrings(content);
      const isBase = file.includes("Base.lproj") || file.includes("en.lproj");
      for (const [key, value] of parsed) {
        if (isBase) {
          if (!map.has(key)) {
            map.set(key, value);
          }
        } else {
          map.set(key, value);
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return map;
}

/**
 * Build a combined string map for a project (both Android and iOS).
 */
export async function buildStringMap(projectPath: string): Promise<Map<string, string>> {
  const [androidMap, iosMap] = await Promise.all([
    buildAndroidStringMap(projectPath),
    buildIosStringMap(projectPath),
  ]);

  // Merge: Android keys prefixed with R.string., iOS keys as-is
  const combined = new Map<string, string>();
  for (const [key, value] of androidMap) {
    combined.set(key, value);
  }
  for (const [key, value] of iosMap) {
    combined.set(key, value);
  }

  return combined;
}

/**
 * Resolve a string resource reference to actual text.
 * - "R.string.phone_title" -> looks up "phone_title" in the map
 * - "NSLocalizedString key" -> looks up the key directly
 */
export function resolveStringRef(ref: string, stringMap: Map<string, string>): string | undefined {
  // Android: R.string.key_name
  const androidMatch = ref.match(/^R\.string\.(\w+)$/);
  if (androidMatch) {
    return stringMap.get(androidMatch[1]);
  }

  // Direct key lookup (iOS or generic)
  return stringMap.get(ref);
}
