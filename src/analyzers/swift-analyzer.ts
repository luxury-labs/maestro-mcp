import type { DiscoveredScreen, UIElement } from "./types.js";
import { resolveStringRef } from "./string-resolver.js";
import { resolveCustomComponent, type ComponentInfo } from "./component-registry.js";
import { parseSwift, findNodesByType, firstStringArg } from "./ast-parser.js";
import type { SyntaxNode, Tree } from "./ast-parser.js";
import { extractBraceBody } from "./utils.js";

/** Extract SwiftUI Views and UIKit ViewControllers from a Swift file (sync, regex-based) */
export function analyzeSwiftFile(
  filePath: string,
  content: string,
  opts?: {
    stringMap?: Map<string, string>;
    componentRegistry?: Map<string, ComponentInfo>;
  }
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  const isSwiftUI = content.includes("import SwiftUI");
  const isUIKit = content.includes("import UIKit") || content.includes("UIViewController");

  if (isSwiftUI) {
    screens.push(...extractSwiftUIViews(filePath, content, opts?.componentRegistry));
  }
  if (isUIKit) {
    screens.push(...extractUIKitControllers(filePath, content));
  }

  // Resolve string references (iOS NSLocalizedString patterns)
  if (opts?.stringMap) {
    for (const screen of screens) {
      for (const el of screen.elements) {
        if (el.resourceId && !el.resolvedText) {
          const resolved = resolveStringRef(el.resourceId, opts.stringMap);
          if (resolved) {
            el.resolvedText = resolved;
          }
        }
      }
    }
  }

  return screens;
}

/**
 * Async variant that attempts AST-based extraction first.
 * Falls back to the synchronous regex approach if tree-sitter is unavailable.
 */
export async function analyzeSwiftFileAsync(
  filePath: string,
  content: string,
  opts?: {
    stringMap?: Map<string, string>;
    componentRegistry?: Map<string, ComponentInfo>;
  },
): Promise<DiscoveredScreen[]> {
  const tree = await parseSwift(content);
  if (tree) {
    const screens = analyzeSwiftFileAST(filePath, content, tree, opts?.componentRegistry);
    // Resolve string references
    if (opts?.stringMap) {
      for (const screen of screens) {
        for (const el of screen.elements) {
          if (el.resourceId && !el.resolvedText) {
            const resolved = resolveStringRef(el.resourceId, opts.stringMap);
            if (resolved) {
              el.resolvedText = resolved;
            }
          }
        }
      }
    }
    return screens;
  }
  // Fallback to regex
  return analyzeSwiftFile(filePath, content, opts);
}

// ---------------------------------------------------------------------------
// AST-based extraction
// ---------------------------------------------------------------------------

function analyzeSwiftFileAST(
  filePath: string,
  content: string,
  tree: Tree,
  componentRegistry?: Map<string, ComponentInfo>,
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  const root = tree.rootNode;
  const isSwiftUI = content.includes("import SwiftUI");
  const isUIKit = content.includes("import UIKit") || content.includes("UIViewController");

  if (isSwiftUI) {
    screens.push(...extractSwiftUIViewsAST(filePath, root, componentRegistry));
  }
  if (isUIKit) {
    screens.push(...extractUIKitControllersAST(filePath, root));
  }

  return screens;
}

/** Find `struct Xxx: View` declarations via AST */
function extractSwiftUIViewsAST(
  filePath: string,
  root: SyntaxNode,
  componentRegistry?: Map<string, ComponentInfo>,
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];

  // tree-sitter-swift uses class_declaration for both class and struct
  const structs = findNodesByType(root, "class_declaration");
  for (const structNode of structs) {
    if (!conformsToViewAST(structNode)) continue;

    const nameNode = structNode.childForFieldName("name")
      ?? structNode.namedChildren.find((c) => c.type === "type_identifier");
    const name = nameNode?.text ?? "UnknownView";

    const elements = extractSwiftUIElementsAST(structNode, componentRegistry);
    const navTargets = extractSwiftUINavigationAST(structNode);

    screens.push({
      name,
      filePath,
      platform: "ios",
      framework: "swiftui",
      type: "SwiftUI View",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Check if a struct/class conforms to View protocol via AST */
function conformsToViewAST(node: SyntaxNode): boolean {
  const inhSpec = node.namedChildren.find((c) => c.type === "inheritance_specifier");
  if (!inhSpec) return false;
  // Look for "View" in the inheritance specifier's type identifiers
  const typeIds = findNodesByType(inhSpec, "type_identifier");
  return typeIds.some((t) => t.text === "View");
}

/** Extract UI elements from a SwiftUI struct's AST subtree */
function extractSwiftUIElementsAST(
  structNode: SyntaxNode,
  componentRegistry?: Map<string, ComponentInfo>,
): UIElement[] {
  const elements: UIElement[] = [];

  // Find all call expressions
  const calls = findNodesByType(structNode, "call_expression");

  for (const call of calls) {
    const funcName = getSwiftCallName(call);
    if (!funcName) continue;

    const strArg = firstStringArg(call);

    switch (funcName) {
      case "Button":
        if (strArg) {
          elements.push({ kind: "button", text: strArg });
        }
        break;
      case "TextField":
        if (strArg) {
          elements.push({ kind: "textField", text: strArg });
        }
        break;
      case "SecureField":
        if (strArg) {
          elements.push({ kind: "textField", text: strArg });
        }
        break;
      case "Text":
        if (strArg && strArg.length > 1) {
          elements.push({ kind: "label", text: strArg });
        }
        break;
      case "Image":
        if (strArg) {
          elements.push({ kind: "image", text: strArg });
        }
        break;
      case "Toggle":
        if (strArg) {
          elements.push({ kind: "toggle", text: strArg });
        }
        break;
      case "Picker":
        if (strArg) {
          elements.push({ kind: "picker", text: strArg });
        }
        break;
      case "Link":
        if (strArg) {
          elements.push({ kind: "link", text: strArg });
        }
        break;
      case "List":
        elements.push({ kind: "list" });
        break;
      default:
        break;
    }
  }

  // .accessibilityIdentifier("id") — appears as navigation_expression.navigation_suffix
  // wrapping the call. We look for the pattern in the text of call expressions.
  const bodyText = structNode.text;
  const a11yRegex = /\.accessibilityIdentifier\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = a11yRegex.exec(bodyText)) !== null) {
    const id = m[1];
    const existing = elements[elements.length - 1];
    if (existing) {
      existing.accessibilityId = id;
    } else {
      elements.push({ kind: "other", accessibilityId: id });
    }
  }

  // Custom component resolution via registry
  if (componentRegistry && componentRegistry.size > 0) {
    const knownPrimitives = new Set([
      "Button", "TextField", "SecureField", "Text", "Label", "Toggle",
      "Image", "List", "Picker", "Link", "NavigationLink", "NavigationView",
      "NavigationStack", "VStack", "HStack", "ZStack", "ScrollView",
      "Form", "Section", "Group", "Spacer", "Divider", "ProgressView",
      "TabView", "GeometryReader",
    ]);
    const componentUsageRegex = /\b([A-Z]\w+)\s*\(([^)]*)\)/g;
    let cm: RegExpExecArray | null;
    while ((cm = componentUsageRegex.exec(bodyText)) !== null) {
      const compName = cm[1];
      const usageText = cm[2];
      if (knownPrimitives.has(compName)) continue;
      const resolved = resolveCustomComponent(compName, usageText, componentRegistry);
      if (resolved) {
        elements.push(resolved);
      }
    }
  }

  return elements;
}

/** Extract navigation targets from a SwiftUI struct's AST subtree */
function extractSwiftUINavigationAST(structNode: SyntaxNode): string[] {
  const targets: string[] = [];
  // Use regex on the struct's text for navigation patterns (AST structure
  // for these is complex and regex is reliable for well-scoped text)
  const text = structNode.text;

  const navLinkDest = /NavigationLink\s*\(.*?destination\s*:\s*(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = navLinkDest.exec(text)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  const navLinkBlock = /NavigationLink\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = navLinkBlock.exec(text)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  const navDest = /\.navigationDestination\([^)]*\)\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = navDest.exec(text)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  const sheetRegex = /\.sheet\([^)]*\)\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = sheetRegex.exec(text)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  const coverRegex = /\.fullScreenCover\([^)]*\)\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = coverRegex.exec(text)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  return targets;
}

/** Extract UIKit ViewControllers via AST */
function extractUIKitControllersAST(filePath: string, root: SyntaxNode): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];

  const classes = findNodesByType(root, "class_declaration");
  for (const classNode of classes) {
    // Check inheritance for UIViewController subtypes
    const inhSpec = classNode.namedChildren.find((c) => c.type === "inheritance_specifier");
    if (!inhSpec) continue;
    if (!/UI(?:View|Table|Collection|Navigation|Tab)Controller/.test(inhSpec.text)) continue;

    const nameNode = classNode.childForFieldName("name")
      ?? classNode.namedChildren.find((c) => c.type === "type_identifier");
    const name = nameNode?.text ?? "UnknownVC";

    // Use regex for element/nav extraction within the scoped body text
    const body = classNode.text;
    const elements = extractUIKitElements(body);
    const navTargets = extractUIKitNavigation(body);

    screens.push({
      name,
      filePath,
      platform: "ios",
      framework: "uikit",
      type: "UIViewController",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Get the function/type name from a Swift call expression node */
function getSwiftCallName(callNode: SyntaxNode): string | null {
  // In tree-sitter-swift, a direct call like `Button("...")` has
  // simple_identifier as the first named child followed by call_suffix.
  // A chained call like `.accessibilityIdentifier(...)` has a
  // navigation_expression as the first named child.
  const first = callNode.namedChildren[0];
  if (!first) return null;

  if (first.type === "simple_identifier") {
    return first.text;
  }

  // For navigation_expression (chained calls), skip — we handle
  // these via regex on the scoped text.
  return null;
}

/** Extract SwiftUI View structs */
function extractSwiftUIViews(
  filePath: string,
  content: string,
  componentRegistry?: Map<string, ComponentInfo>
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];

  // Match: struct SomeName: View {
  const viewRegex = /struct\s+(\w+)\s*:\s*(?:\w+,\s*)*View\b/g;
  let match;

  while ((match = viewRegex.exec(content)) !== null) {
    const name = match[1];
    const body = extractBraceBody(content, match.index);
    const elements = extractSwiftUIElements(body, name, componentRegistry);
    const navTargets = extractSwiftUINavigation(body, name);

    screens.push({
      name,
      filePath,
      platform: "ios",
      framework: "swiftui",
      type: "SwiftUI View",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Extract UI elements from SwiftUI body */
function extractSwiftUIElements(
  content: string,
  _viewName: string,
  componentRegistry?: Map<string, ComponentInfo>
): UIElement[] {
  const elements: UIElement[] = [];

  // Button("Title") or Button(action:) { Text("...") }
  const buttonTextRegex = /Button\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = buttonTextRegex.exec(content)) !== null) {
    elements.push({ kind: "button", text: m[1] });
  }

  // Button(action:...) { ... Label("text", ...) or Text("text") }
  const buttonBlockRegex = /Button\s*\(\s*action\s*:.*?\)\s*\{[^}]*?(?:Text|Label)\(\s*"([^"]+)"/gs;
  let m2: RegExpExecArray | null;
  while ((m2 = buttonBlockRegex.exec(content)) !== null) {
    if (!elements.some((e) => e.text === m2![1])) {
      elements.push({ kind: "button", text: m2[1] });
    }
  }

  // TextField("placeholder", ...)
  const textFieldRegex = /TextField\(\s*"([^"]+)"/g;
  while ((m = textFieldRegex.exec(content)) !== null) {
    elements.push({ kind: "textField", text: m[1] });
  }

  // SecureField("placeholder", ...)
  const secureFieldRegex = /SecureField\(\s*"([^"]+)"/g;
  while ((m = secureFieldRegex.exec(content)) !== null) {
    elements.push({ kind: "textField", text: m[1] });
  }

  // Text("content")
  const textRegex = /Text\(\s*"([^"]+)"/g;
  while ((m = textRegex.exec(content)) !== null) {
    // Skip very short or common framework texts
    if (m[1].length > 1) {
      elements.push({ kind: "label", text: m[1] });
    }
  }

  // Image(systemName: "...") or Image("...")
  const imageRegex = /Image\(\s*(?:systemName:\s*)?"([^"]+)"/g;
  while ((m = imageRegex.exec(content)) !== null) {
    elements.push({ kind: "image", text: m[1] });
  }

  // Toggle("label", ...)
  const toggleRegex = /Toggle\(\s*"([^"]+)"/g;
  while ((m = toggleRegex.exec(content)) !== null) {
    elements.push({ kind: "toggle", text: m[1] });
  }

  // Picker("label", ...)
  const pickerRegex = /Picker\(\s*"([^"]+)"/g;
  while ((m = pickerRegex.exec(content)) !== null) {
    elements.push({ kind: "picker", text: m[1] });
  }

  // List { ... }
  if (/\bList\s*[\{(]/.test(content)) {
    elements.push({ kind: "list" });
  }

  // .accessibilityIdentifier("id")
  const a11yRegex = /\.accessibilityIdentifier\(\s*"([^"]+)"/g;
  while ((m = a11yRegex.exec(content)) !== null) {
    // Try to attach to the nearest element
    const existing = elements[elements.length - 1];
    if (existing) {
      existing.accessibilityId = m[1];
    } else {
      elements.push({ kind: "other", accessibilityId: m[1] });
    }
  }

  // Link("title", destination: ...)
  const linkRegex = /Link\(\s*"([^"]+)"/g;
  while ((m = linkRegex.exec(content)) !== null) {
    elements.push({ kind: "link", text: m[1] });
  }

  // Custom component resolution via registry
  if (componentRegistry && componentRegistry.size > 0) {
    const knownPrimitives = new Set([
      "Button", "TextField", "SecureField", "Text", "Label", "Toggle",
      "Image", "List", "Picker", "Link", "NavigationLink", "NavigationView",
      "NavigationStack", "VStack", "HStack", "ZStack", "ScrollView",
      "Form", "Section", "Group", "Spacer", "Divider", "ProgressView",
      "TabView", "GeometryReader",
    ]);
    const componentUsageRegex = /\b([A-Z]\w+)\s*\(([^)]*)\)/g;
    let cm: RegExpExecArray | null;
    while ((cm = componentUsageRegex.exec(content)) !== null) {
      const compName = cm[1];
      const usageText = cm[2];
      if (knownPrimitives.has(compName)) continue;
      const resolved = resolveCustomComponent(compName, usageText, componentRegistry);
      if (resolved) {
        elements.push(resolved);
      }
    }
  }

  return elements;
}

/** Extract navigation targets from SwiftUI */
function extractSwiftUINavigation(content: string, _viewName: string): string[] {
  const targets: string[] = [];

  // NavigationLink(destination: SomeView())
  const navLinkDest = /NavigationLink\s*\(.*?destination\s*:\s*(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = navLinkDest.exec(content)) !== null) {
    targets.push(m[1]);
  }

  // NavigationLink { SomeView() } label:
  const navLinkBlock = /NavigationLink\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = navLinkBlock.exec(content)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  // .navigationDestination(for:...) { _ in SomeView() }
  const navDest = /\.navigationDestination\([^)]*\)\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = navDest.exec(content)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  // .sheet(isPresented:...) { SomeView() }
  const sheetRegex = /\.sheet\([^)]*\)\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = sheetRegex.exec(content)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  // .fullScreenCover
  const coverRegex = /\.fullScreenCover\([^)]*\)\s*\{[^}]*?(\w+)\(\)/g;
  while ((m = coverRegex.exec(content)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  return targets;
}

/** Extract UIKit ViewControllers */
function extractUIKitControllers(filePath: string, content: string): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];

  // class SomeName: UIViewController
  const vcRegex = /class\s+(\w+)\s*:\s*(?:\w+,\s*)*UI(?:View|Table|Collection|Navigation|Tab)Controller/g;
  let match;

  while ((match = vcRegex.exec(content)) !== null) {
    const name = match[1];
    const body = extractBraceBody(content, match.index);
    const elements = extractUIKitElements(body);
    const navTargets = extractUIKitNavigation(body);

    screens.push({
      name,
      filePath,
      platform: "ios",
      framework: "uikit",
      type: "UIViewController",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Extract UI elements from UIKit code */
function extractUIKitElements(content: string): UIElement[] {
  const elements: UIElement[] = [];
  let m: RegExpExecArray | null;

  // UIButton — setTitle("text", for: .normal)
  const btnRegex = /\.setTitle\(\s*"([^"]+)"/g;
  while ((m = btnRegex.exec(content)) !== null) {
    elements.push({ kind: "button", text: m[1] });
  }

  // UILabel — .text = "..."
  const labelRegex = /\.text\s*=\s*"([^"]+)"/g;
  while ((m = labelRegex.exec(content)) !== null) {
    elements.push({ kind: "label", text: m[1] });
  }

  // UITextField — .placeholder = "..."
  const placeholderRegex = /\.placeholder\s*=\s*"([^"]+)"/g;
  while ((m = placeholderRegex.exec(content)) !== null) {
    elements.push({ kind: "textField", text: m[1] });
  }

  // .accessibilityIdentifier = "..."
  const a11yRegex = /\.accessibilityIdentifier\s*=\s*"([^"]+)"/g;
  while ((m = a11yRegex.exec(content)) !== null) {
    elements.push({ kind: "other", accessibilityId: m[1] });
  }

  // UITableView / UICollectionView
  if (/UITableView|tableView/.test(content)) {
    elements.push({ kind: "list" });
  }

  return elements;
}

/** Extract navigation from UIKit */
function extractUIKitNavigation(content: string): string[] {
  const targets: string[] = [];
  let m: RegExpExecArray | null;

  // pushViewController(SomeVC(), ...)
  const pushRegex = /pushViewController\(\s*(\w+)\s*\(/g;
  while ((m = pushRegex.exec(content)) !== null) {
    targets.push(m[1]);
  }

  // present(SomeVC(), ...)
  const presentRegex = /present\(\s*(\w+)\s*\(/g;
  while ((m = presentRegex.exec(content)) !== null) {
    targets.push(m[1]);
  }

  // performSegue(withIdentifier: "name", ...)
  const segueRegex = /performSegue\(\s*withIdentifier\s*:\s*"([^"]+)"/g;
  while ((m = segueRegex.exec(content)) !== null) {
    targets.push(m[1]);
  }

  return targets;
}
