import fs from "node:fs/promises";
import path from "node:path";
import type { UIElement } from "./types.js";
import { extractBraceBody } from "./utils.js";

/** What a custom component wraps */
export interface ComponentInfo {
  /** The primitive UI kind this component wraps */
  wraps: UIElement["kind"];
  /** The parameter name that holds the display text (e.g. "text", "title", "label") */
  textParam?: string;
}

/**
 * Recursively find files matching an extension.
 */
async function findFiles(
  dir: string,
  extensions: string[],
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
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir, 0);
  return results;
}

/** Map of primitive UI component names to their kind */
const KOTLIN_PRIMITIVES: Record<string, UIElement["kind"]> = {
  Button: "button",
  TextButton: "button",
  OutlinedButton: "button",
  ElevatedButton: "button",
  IconButton: "button",
  FloatingActionButton: "button",
  ExtendedFloatingActionButton: "button",
  TextField: "textField",
  OutlinedTextField: "textField",
  BasicTextField: "textField",
  Text: "label",
  Switch: "toggle",
  Checkbox: "toggle",
  RadioButton: "toggle",
  Image: "image",
  Icon: "image",
  LazyColumn: "list",
  LazyRow: "list",
};

const SWIFT_PRIMITIVES: Record<string, UIElement["kind"]> = {
  Button: "button",
  TextField: "textField",
  SecureField: "textField",
  Text: "label",
  Label: "label",
  Toggle: "toggle",
  Image: "image",
  List: "list",
  Picker: "picker",
  Link: "link",
};

/** Common text parameter names in order of priority */
const TEXT_PARAMS = ["text", "title", "label", "message", "placeholder", "description", "content"];

/**
 * Scan Kotlin files for custom @Composable definitions that wrap primitive components.
 */
export function scanKotlinComponents(content: string): Map<string, ComponentInfo> {
  const registry = new Map<string, ComponentInfo>();

  // Match @Composable fun ComponentName(params...) { body }
  const composableRegex = /@Composable\s+fun\s+(\w+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = composableRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2];
    const body = extractBraceBody(content, match.index);

    if (!body) continue;

    // Check if body uses any primitive UI component
    for (const [primitive, kind] of Object.entries(KOTLIN_PRIMITIVES)) {
      // Look for PrimitiveName( or PrimitiveName { patterns in the body
      const primitivePattern = new RegExp(`\\b${primitive}\\s*[({]`);
      if (primitivePattern.test(body)) {
        // Find which text parameter this component accepts
        const textParam = findTextParam(params);
        registry.set(name, { wraps: kind, textParam: textParam ?? undefined });
        break; // Use first match (most significant)
      }
    }
  }

  return registry;
}

/**
 * Scan Swift files for custom View structs that wrap primitive components.
 */
export function scanSwiftComponents(content: string): Map<string, ComponentInfo> {
  const registry = new Map<string, ComponentInfo>();

  // Match struct ComponentName: View { body }
  const viewRegex = /struct\s+(\w+)\s*:\s*(?:\w+,\s*)*View\b/g;
  let match: RegExpExecArray | null;

  while ((match = viewRegex.exec(content)) !== null) {
    const name = match[1];
    const body = extractBraceBody(content, match.index);

    if (!body) continue;

    // Extract stored properties that might be text params
    // e.g. let title: String, var text: String
    const propRegex = /(?:let|var)\s+(\w+)\s*:\s*String/g;
    let propMatch: RegExpExecArray | null;
    const stringProps: string[] = [];
    while ((propMatch = propRegex.exec(body)) !== null) {
      stringProps.push(propMatch[1]);
    }

    // Check if body contains any primitive SwiftUI component
    for (const [primitive, kind] of Object.entries(SWIFT_PRIMITIVES)) {
      const primitivePattern = new RegExp(`\\b${primitive}\\s*[({]`);
      if (primitivePattern.test(body)) {
        // Find the best text param from stored properties
        const textParam = stringProps.find((p) =>
          TEXT_PARAMS.includes(p.toLowerCase())
        ) ?? stringProps[0];
        registry.set(name, { wraps: kind, textParam: textParam ?? undefined });
        break;
      }
    }
  }

  return registry;
}

/**
 * Find the most likely text parameter from a Kotlin parameter list.
 */
function findTextParam(params: string): string | null {
  // Parse parameter names: look for "name: String" patterns
  const paramRegex = /(\w+)\s*:\s*String/g;
  let m: RegExpExecArray | null;
  const stringParams: string[] = [];

  while ((m = paramRegex.exec(params)) !== null) {
    stringParams.push(m[1]);
  }

  // Return first matching known text param name
  for (const known of TEXT_PARAMS) {
    const found = stringParams.find((p) => p.toLowerCase() === known);
    if (found) return found;
  }

  // Fall back to first String param
  return stringParams[0] ?? null;
}

/**
 * Build a component registry by scanning all source files in a project.
 */
export async function buildComponentRegistry(
  projectPath: string
): Promise<Map<string, ComponentInfo>> {
  const registry = new Map<string, ComponentInfo>();

  const [kotlinFiles, swiftFiles] = await Promise.all([
    findFiles(projectPath, [".kt"]),
    findFiles(projectPath, [".swift"]),
  ]);

  // Process Kotlin files
  for (const file of kotlinFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const fileRegistry = scanKotlinComponents(content);
      for (const [name, info] of fileRegistry) {
        registry.set(name, info);
      }
    } catch {
      // skip unreadable files
    }
  }

  // Process Swift files
  for (const file of swiftFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const fileRegistry = scanSwiftComponents(content);
      for (const [name, info] of fileRegistry) {
        registry.set(name, info);
      }
    } catch {
      // skip unreadable files
    }
  }

  return registry;
}

/**
 * Try to extract a UIElement from a custom component usage, given the registry.
 * e.g. PrimaryButton(text = "Send") -> { kind: "button", text: "Send" }
 */
export function resolveCustomComponent(
  componentName: string,
  usageText: string,
  registry: Map<string, ComponentInfo>
): UIElement | undefined {
  const info = registry.get(componentName);
  if (!info) return undefined;

  // Try to extract text from the usage
  let text: string | undefined;

  if (info.textParam) {
    // Look for named parameter: textParam = "value"
    const namedRegex = new RegExp(`${info.textParam}\\s*=\\s*"([^"]+)"`);
    const namedMatch = usageText.match(namedRegex);
    if (namedMatch) {
      text = namedMatch[1];
    }
  }

  // Fallback: first string literal in the usage
  if (!text) {
    const stringMatch = usageText.match(/"([^"]+)"/);
    if (stringMatch) {
      text = stringMatch[1];
    }
  }

  return {
    kind: info.wraps,
    text,
  };
}
