import type { DiscoveredScreen, UIElement } from "./types.js";
import { resolveStringRef } from "./string-resolver.js";
import { resolveCustomComponent, type ComponentInfo } from "./component-registry.js";
import { parseKotlin, findNodes, findNodesByType, firstStringArg } from "./ast-parser.js";
import type { SyntaxNode, Tree } from "./ast-parser.js";
import { extractBraceBody } from "./utils.js";

/** Extract Activities, Fragments, and Composable screens from Kotlin (sync, regex-based) */
export function analyzeKotlinFile(
  filePath: string,
  content: string,
  opts?: {
    stringMap?: Map<string, string>;
    componentRegistry?: Map<string, ComponentInfo>;
  }
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  const isCompose = content.includes("@Composable");

  // Jetpack Compose screens
  if (isCompose) {
    screens.push(...extractComposeScreens(filePath, content, opts?.componentRegistry));
  }

  // Activities
  screens.push(...extractActivities(filePath, content));

  // Fragments
  screens.push(...extractFragments(filePath, content));

  // Resolve string references if a string map was provided
  if (opts?.stringMap) {
    for (const screen of screens) {
      for (const el of screen.elements) {
        if (el.resourceId && el.resourceId.startsWith("R.string.")) {
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
export async function analyzeKotlinFileAsync(
  filePath: string,
  content: string,
  opts?: {
    stringMap?: Map<string, string>;
    componentRegistry?: Map<string, ComponentInfo>;
  },
): Promise<DiscoveredScreen[]> {
  const tree = await parseKotlin(content);
  if (tree) {
    const screens = analyzeKotlinFileAST(filePath, content, tree, opts?.componentRegistry);
    // Resolve string references
    if (opts?.stringMap) {
      for (const screen of screens) {
        for (const el of screen.elements) {
          if (el.resourceId && el.resourceId.startsWith("R.string.")) {
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
  return analyzeKotlinFile(filePath, content, opts);
}

// ---------------------------------------------------------------------------
// AST-based extraction
// ---------------------------------------------------------------------------

function analyzeKotlinFileAST(
  filePath: string,
  content: string,
  tree: Tree,
  componentRegistry?: Map<string, ComponentInfo>,
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  const root = tree.rootNode;
  const isCompose = content.includes("@Composable");

  if (isCompose) {
    screens.push(...extractComposeScreensAST(filePath, root, componentRegistry));
  }

  // Activities and Fragments still use regex (XML-based Android patterns
  // don't benefit as much from AST parsing, and the class-based patterns
  // are simple enough for regex)
  screens.push(...extractActivities(filePath, content));
  screens.push(...extractFragments(filePath, content));

  return screens;
}

/** Find @Composable functions via AST */
function extractComposeScreensAST(
  filePath: string,
  root: SyntaxNode,
  componentRegistry?: Map<string, ComponentInfo>,
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];

  const funcDecls = findNodesByType(root, "function_declaration");
  for (const funcNode of funcDecls) {
    if (!hasComposableAnnotation(funcNode)) continue;

    const nameNode = funcNode.namedChildren.find((c) => c.type === "simple_identifier");
    const name = nameNode?.text ?? "UnknownComposable";

    // Skip small helper composables (lowercase first letter or very short names)
    if (name[0] === name[0].toLowerCase() && name.length < 6) continue;

    const elements = extractComposeElementsAST(funcNode, componentRegistry);
    const navTargets = extractComposeNavigationAST(funcNode);

    screens.push({
      name,
      filePath,
      platform: "android",
      framework: "jetpack-compose",
      type: "Composable",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Check if a function_declaration has @Composable annotation */
function hasComposableAnnotation(funcNode: SyntaxNode): boolean {
  const mods = funcNode.namedChildren.find((c) => c.type === "modifiers");
  if (!mods) return false;
  const annotations = mods.namedChildren.filter((c) => c.type === "annotation");
  for (const annot of annotations) {
    const userType = annot.namedChildren.find((c) => c.type === "user_type");
    if (userType) {
      const typeId = userType.namedChildren.find((c) => c.type === "type_identifier");
      if (typeId?.text === "Composable") return true;
    }
  }
  return false;
}

/** Extract UI elements from a Composable function's AST subtree */
function extractComposeElementsAST(
  funcNode: SyntaxNode,
  componentRegistry?: Map<string, ComponentInfo>,
): UIElement[] {
  const elements: UIElement[] = [];

  // Find all call_expression nodes within the function body
  const calls = findNodesByType(funcNode, "call_expression");

  for (const call of calls) {
    const funcName = getKotlinCallName(call);
    if (!funcName) continue;

    switch (funcName) {
      case "Button":
      case "TextButton":
      case "OutlinedButton":
      case "ElevatedButton": {
        // Button content is in the trailing lambda: Button(onClick = {}) { Text("label") }
        const textInBody = findTextInTrailingLambda(call);
        if (textInBody) {
          elements.push({ kind: "button", text: textInBody });
        }
        break;
      }
      case "TextField":
      case "OutlinedTextField": {
        // Look for label = { Text("...") } or placeholder = { Text("...") }
        const labelText = findNamedLambdaText(call, "label");
        if (labelText) {
          elements.push({ kind: "textField", text: labelText });
        } else {
          const placeholderText = findNamedLambdaText(call, "placeholder");
          if (placeholderText) {
            elements.push({ kind: "textField", text: placeholderText });
          }
        }
        break;
      }
      case "Text": {
        const strArg = firstStringArg(call);
        if (strArg && strArg.length > 1 && !elements.some((e) => e.text === strArg)) {
          elements.push({ kind: "label", text: strArg });
        }
        break;
      }
      case "Image": {
        // Image(painter = ..., contentDescription = "...")
        const desc = findNamedStringArg(call, "contentDescription");
        if (desc) {
          elements.push({ kind: "image", text: desc });
        }
        break;
      }
      case "Switch":
        elements.push({ kind: "toggle" });
        break;
      case "LazyColumn":
      case "LazyRow":
        elements.push({ kind: "list" });
        break;
      default:
        break;
    }
  }

  // Text(stringResource(R.string.xxx))
  const bodyText = funcNode.text;
  const stringResRegex = /Text\(\s*stringResource\(\s*R\.string\.(\w+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = stringResRegex.exec(bodyText)) !== null) {
    elements.push({ kind: "label", resourceId: `R.string.${m[1]}` });
  }

  // Modifier.testTag("tag")
  const testTagRegex = /\.testTag\(\s*"([^"]+)"/g;
  while ((m = testTagRegex.exec(bodyText)) !== null) {
    const existing = elements[elements.length - 1];
    if (existing) {
      existing.accessibilityId = m[1];
    } else {
      elements.push({ kind: "other", accessibilityId: m[1] });
    }
  }

  // contentDescription = "..."
  const semanticsRegex = /contentDescription\s*=\s*"([^"]+)"/g;
  while ((m = semanticsRegex.exec(bodyText)) !== null) {
    if (!elements.some((e) => e.accessibilityId === m![1] || e.text === m![1])) {
      elements.push({ kind: "other", accessibilityId: m[1] });
    }
  }

  // Custom component resolution via registry
  if (componentRegistry && componentRegistry.size > 0) {
    const knownPrimitives = new Set([
      "Button", "TextButton", "OutlinedButton", "ElevatedButton", "IconButton",
      "FloatingActionButton", "TextField", "OutlinedTextField", "BasicTextField",
      "Text", "Image", "Icon", "Switch", "Checkbox", "RadioButton",
      "LazyColumn", "LazyRow", "Column", "Row", "Box", "Card", "Scaffold",
      "Surface", "TopAppBar", "BottomNavigation", "NavigationBar", "Spacer",
      "Divider", "CircularProgressIndicator", "LinearProgressIndicator",
    ]);
    const componentUsageRegex = /\b([A-Z]\w+)\s*\(([^)]*)\)/g;
    while ((m = componentUsageRegex.exec(bodyText)) !== null) {
      const compName = m[1];
      const usageText = m[2];
      if (knownPrimitives.has(compName)) continue;
      const resolved = resolveCustomComponent(compName, usageText, componentRegistry);
      if (resolved) {
        elements.push(resolved);
      }
    }
  }

  return elements;
}

/** Extract navigation targets from a Composable function's AST subtree */
function extractComposeNavigationAST(funcNode: SyntaxNode): string[] {
  const targets: string[] = [];
  const bodyText = funcNode.text;

  // navController.navigate("route")
  const navRegex = /navController\.navigate\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = navRegex.exec(bodyText)) !== null) {
    targets.push(m[1]);
  }

  // navController.navigate(SomeRoute)
  const navObjRegex = /navController\.navigate\(\s*(\w+)\s*[,)]/g;
  while ((m = navObjRegex.exec(bodyText)) !== null) {
    if (m[1] !== "route" && m[1][0] === m[1][0].toUpperCase()) {
      targets.push(m[1]);
    }
  }

  return targets;
}

/** Get the function name from a Kotlin call expression node */
function getKotlinCallName(callNode: SyntaxNode): string | null {
  // Direct call: simple_identifier followed by call_suffix
  const first = callNode.namedChildren[0];
  if (!first) return null;

  if (first.type === "simple_identifier") {
    return first.text;
  }

  // For Button with trailing lambda, the outer call_expression wraps
  // an inner call_expression (the one with value_arguments) + call_suffix (the lambda).
  // The inner call has the simple_identifier.
  if (first.type === "call_expression") {
    const innerFirst = first.namedChildren[0];
    if (innerFirst?.type === "simple_identifier") {
      return innerFirst.text;
    }
  }

  return null;
}

/** Find Text("...") inside a trailing lambda of a call expression */
function findTextInTrailingLambda(callNode: SyntaxNode): string | null {
  // The trailing lambda is in a call_suffix > annotated_lambda > lambda_literal
  // or call_suffix > lambda_literal
  const lambdas = findNodesByType(callNode, "lambda_literal");
  for (const lambda of lambdas) {
    // Look for Text() calls inside
    const textCalls = findNodes(lambda, (n) => {
      if (n.type !== "call_expression") return false;
      const nameChild = n.namedChildren[0];
      return nameChild?.type === "simple_identifier" && nameChild.text === "Text";
    });
    for (const textCall of textCalls) {
      const str = firstStringArg(textCall);
      if (str) return str;
    }
  }
  return null;
}

/** Find the string value in a named lambda argument, e.g. label = { Text("Email") } */
function findNamedLambdaText(callNode: SyntaxNode, argName: string): string | null {
  // Look through value_argument nodes for one whose label matches argName
  const valueArgs = findNodesByType(callNode, "value_argument");
  for (const arg of valueArgs) {
    // Check if first child is simple_identifier matching argName
    const label = arg.namedChildren[0];
    if (label?.type === "simple_identifier" && label.text === argName) {
      // Look for Text() call inside
      const textCalls = findNodes(arg, (n) => {
        if (n.type !== "call_expression") return false;
        const nameChild = n.namedChildren[0];
        return nameChild?.type === "simple_identifier" && nameChild.text === "Text";
      });
      for (const textCall of textCalls) {
        const str = firstStringArg(textCall);
        if (str) return str;
      }
    }
  }
  return null;
}

/** Find a named string argument value, e.g. contentDescription = "..." */
function findNamedStringArg(callNode: SyntaxNode, argName: string): string | null {
  const valueArgs = findNodesByType(callNode, "value_argument");
  for (const arg of valueArgs) {
    const label = arg.namedChildren[0];
    if (label?.type === "simple_identifier" && label.text === argName) {
      return firstStringArg(arg);
    }
  }
  return null;
}

/** Extract @Composable functions that look like screens */
function extractComposeScreens(
  filePath: string,
  content: string,
  componentRegistry?: Map<string, ComponentInfo>
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];

  // @Composable fun ScreenName(...)
  const composableRegex = /@Composable\s+fun\s+(\w+)\s*\(/g;
  let match;

  while ((match = composableRegex.exec(content)) !== null) {
    const name = match[1];
    // Skip small helper composables (lowercase first letter or very short names)
    if (name[0] === name[0].toLowerCase() && name.length < 6) continue;

    const body = extractBraceBody(content, match.index);
    const elements = extractComposeElements(body, name, componentRegistry);
    const navTargets = extractComposeNavigation(body);

    screens.push({
      name,
      filePath,
      platform: "android",
      framework: "jetpack-compose",
      type: "Composable",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Extract UI elements from Compose code */
function extractComposeElements(
  content: string,
  _screenName: string,
  componentRegistry?: Map<string, ComponentInfo>
): UIElement[] {
  const elements: UIElement[] = [];
  let m: RegExpExecArray | null;

  // Button(onClick = ...) { Text("label") }
  const buttonRegex = /Button\s*\([^)]*\)\s*\{[^}]*?Text\(\s*(?:text\s*=\s*)?"([^"]+)"/gs;
  while ((m = buttonRegex.exec(content)) !== null) {
    elements.push({ kind: "button", text: m[1] });
  }

  // TextButton, OutlinedButton, IconButton, FloatingActionButton
  const altBtnRegex = /(?:TextButton|OutlinedButton|ElevatedButton)\s*\([^)]*\)\s*\{[^}]*?Text\(\s*(?:text\s*=\s*)?"([^"]+)"/gs;
  let m2: RegExpExecArray | null;
  while ((m2 = altBtnRegex.exec(content)) !== null) {
    elements.push({ kind: "button", text: m2[1] });
  }

  // TextField(value = ..., label = { Text("label") }, placeholder = { Text("placeholder") })
  const textFieldLabel = /(?:TextField|OutlinedTextField)\s*\([^)]*label\s*=\s*\{[^}]*?Text\(\s*"([^"]+)"/gs;
  let m3: RegExpExecArray | null;
  while ((m3 = textFieldLabel.exec(content)) !== null) {
    elements.push({ kind: "textField", text: m3[1] });
  }

  const textFieldPlaceholder = /(?:TextField|OutlinedTextField)\s*\([^)]*placeholder\s*=\s*\{[^}]*?Text\(\s*"([^"]+)"/gs;
  let m4: RegExpExecArray | null;
  while ((m4 = textFieldPlaceholder.exec(content)) !== null) {
    if (!elements.some((e) => e.text === m4![1])) {
      elements.push({ kind: "textField", text: m4[1] });
    }
  }

  // Text("content") — standalone
  const textRegex = /Text\(\s*(?:text\s*=\s*)?"([^"]+)"/g;
  while ((m = textRegex.exec(content)) !== null) {
    if (m![1].length > 1 && !elements.some((e) => e.text === m![1])) {
      elements.push({ kind: "label", text: m![1] });
    }
  }

  // Text(stringResource(R.string.xxx))
  const stringResRegex = /Text\(\s*stringResource\(\s*R\.string\.(\w+)\s*\)/g;
  while ((m = stringResRegex.exec(content)) !== null) {
    elements.push({ kind: "label", resourceId: `R.string.${m[1]}` });
  }

  // Switch / Checkbox
  const switchRegex = /Switch\s*\(/g;
  while ((m = switchRegex.exec(content)) !== null) {
    elements.push({ kind: "toggle" });
  }

  // LazyColumn / LazyRow
  if (/Lazy(?:Column|Row)\s*[\({]/.test(content)) {
    elements.push({ kind: "list" });
  }

  // Modifier.testTag("tag")
  const testTagRegex = /\.testTag\(\s*"([^"]+)"/g;
  while ((m = testTagRegex.exec(content)) !== null) {
    const existing = elements[elements.length - 1];
    if (existing) {
      existing.accessibilityId = m[1];
    } else {
      elements.push({ kind: "other", accessibilityId: m[1] });
    }
  }

  // Modifier.semantics { contentDescription = "..." }
  const semanticsRegex = /contentDescription\s*=\s*"([^"]+)"/g;
  while ((m = semanticsRegex.exec(content)) !== null) {
    elements.push({ kind: "other", accessibilityId: m[1] });
  }

  // Image(painter = ..., contentDescription = "...")
  const imageRegex = /Image\s*\([^)]*contentDescription\s*=\s*"([^"]+)"/g;
  while ((m = imageRegex.exec(content)) !== null) {
    elements.push({ kind: "image", text: m[1] });
  }

  // Custom component resolution via registry
  if (componentRegistry && componentRegistry.size > 0) {
    // Match CapitalizedName(params...) patterns that aren't already known primitives
    const knownPrimitives = new Set([
      "Button", "TextButton", "OutlinedButton", "ElevatedButton", "IconButton",
      "FloatingActionButton", "TextField", "OutlinedTextField", "BasicTextField",
      "Text", "Image", "Icon", "Switch", "Checkbox", "RadioButton",
      "LazyColumn", "LazyRow", "Column", "Row", "Box", "Card", "Scaffold",
      "Surface", "TopAppBar", "BottomNavigation", "NavigationBar", "Spacer",
      "Divider", "CircularProgressIndicator", "LinearProgressIndicator",
    ]);
    const componentUsageRegex = /\b([A-Z]\w+)\s*\(([^)]*)\)/g;
    while ((m = componentUsageRegex.exec(content)) !== null) {
      const compName = m[1];
      const usageText = m[2];
      if (knownPrimitives.has(compName)) continue;
      const resolved = resolveCustomComponent(compName, usageText, componentRegistry);
      if (resolved) {
        elements.push(resolved);
      }
    }
  }

  return elements;
}

/** Extract navigation from Compose code */
function extractComposeNavigation(content: string): string[] {
  const targets: string[] = [];
  let m: RegExpExecArray | null;

  // navController.navigate("route")
  const navRegex = /navController\.navigate\(\s*"([^"]+)"/g;
  while ((m = navRegex.exec(content)) !== null) {
    targets.push(m[1]);
  }

  // navController.navigate(SomeRoute)
  const navObjRegex = /navController\.navigate\(\s*(\w+)\s*[,)]/g;
  while ((m = navObjRegex.exec(content)) !== null) {
    if (m[1] !== "route" && m[1][0] === m[1][0].toUpperCase()) {
      targets.push(m[1]);
    }
  }

  return targets;
}

/** Extract Activity classes */
function extractActivities(filePath: string, content: string): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  const activityRegex = /class\s+(\w+)\s*:\s*(?:\w+,\s*)*(?:App)?(?:Compat)?Activity\s*\(/g;
  let match;

  while ((match = activityRegex.exec(content)) !== null) {
    const name = match[1];
    const body = extractBraceBody(content, match.index);
    const elements = extractViewBindingElements(body);
    const navTargets = extractIntentNavigation(body);

    screens.push({
      name,
      filePath,
      platform: "android",
      framework: content.includes("@Composable") ? "jetpack-compose" : "android-xml",
      type: "Activity",
      elements,
      navigationTargets: navTargets,
    });
  }

  return screens;
}

/** Extract Fragment classes */
function extractFragments(filePath: string, content: string): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  const fragRegex = /class\s+(\w+)\s*:\s*(?:\w+,\s*)*Fragment\s*\(/g;
  let match;

  while ((match = fragRegex.exec(content)) !== null) {
    const name = match[1];
    const body = extractBraceBody(content, match.index);
    screens.push({
      name,
      filePath,
      platform: "android",
      framework: content.includes("@Composable") ? "jetpack-compose" : "android-xml",
      type: "Fragment",
      elements: extractViewBindingElements(body),
      navigationTargets: extractIntentNavigation(body),
    });
  }

  return screens;
}

/** Extract elements from view binding / findViewById patterns */
function extractViewBindingElements(content: string): UIElement[] {
  const elements: UIElement[] = [];
  let m: RegExpExecArray | null;

  // findViewById<Type>(R.id.name)
  const findViewRegex = /findViewById\s*<\s*(\w+)\s*>\s*\(\s*R\.id\.(\w+)\s*\)/g;
  while ((m = findViewRegex.exec(content)) !== null) {
    const type = m[1];
    const id = m[2];
    let kind: UIElement["kind"] = "other";
    if (/Button/.test(type)) kind = "button";
    else if (/EditText|TextInput/.test(type)) kind = "textField";
    else if (/TextView/.test(type)) kind = "label";
    else if (/ImageView/.test(type)) kind = "image";
    else if (/RecyclerView|ListView/.test(type)) kind = "list";
    else if (/Switch|CheckBox|Toggle/.test(type)) kind = "toggle";
    elements.push({ kind, resourceId: `R.id.${id}` });
  }

  // binding.someView — ViewBinding pattern
  const bindingRegex = /binding\.(\w+)\.(?:text|setOnClickListener|isChecked)/g;
  while ((m = bindingRegex.exec(content)) !== null) {
    elements.push({ kind: "other", resourceId: m[1] });
  }

  // .text = "literal"
  const textAssignRegex = /\.text\s*=\s*"([^"]+)"/g;
  while ((m = textAssignRegex.exec(content)) !== null) {
    elements.push({ kind: "label", text: m[1] });
  }

  return elements;
}

/** Extract navigation from Intent-based patterns */
function extractIntentNavigation(content: string): string[] {
  const targets: string[] = [];
  let m: RegExpExecArray | null;

  // Intent(this, SomeActivity::class.java)
  const intentRegex = /Intent\(\s*\w+\s*,\s*(\w+)\s*::\s*class/g;
  while ((m = intentRegex.exec(content)) !== null) {
    targets.push(m[1]);
  }

  // startActivity(Intent(... SomeActivity ...))
  const startRegex = /startActivity\([^)]*?(\w+Activity)/g;
  while ((m = startRegex.exec(content)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }

  // findNavController().navigate(R.id.action_xxx)
  const navActionRegex = /navigate\(\s*R\.id\.(\w+)/g;
  while ((m = navActionRegex.exec(content)) !== null) {
    targets.push(m[1]);
  }

  return targets;
}

/** Analyze an Android layout XML file */
export function analyzeLayoutXml(
  filePath: string,
  content: string
): DiscoveredScreen[] {
  const name = filePath.split("/").pop()?.replace(".xml", "") ?? "unknown_layout";
  const elements: UIElement[] = [];
  let m: RegExpExecArray | null;

  // Extract android:id="@+id/xxx"
  const idRegex = /android:id="@\+id\/(\w+)"/g;
  const ids: string[] = [];
  while ((m = idRegex.exec(content)) !== null) {
    ids.push(m[1]);
  }

  // Buttons
  const buttonRegex = /<(?:\w+\.)*(?:Button|MaterialButton|ImageButton)\b[^>]*android:text="([^"]*)"[^>]*/gs;
  while ((m = buttonRegex.exec(content)) !== null) {
    const idMatch = m[0].match(/android:id="@\+id\/(\w+)"/);
    elements.push({
      kind: "button",
      text: m[1] || undefined,
      resourceId: idMatch ? `R.id.${idMatch[1]}` : undefined,
    });
  }

  // EditText / TextInputEditText
  const editRegex = /<(?:\w+\.)*(?:EditText|TextInputEditText)\b[^>]*/gs;
  while ((m = editRegex.exec(content)) !== null) {
    const hintMatch = m[0].match(/android:hint="([^"]*)"/);
    const idMatch = m[0].match(/android:id="@\+id\/(\w+)"/);
    elements.push({
      kind: "textField",
      text: hintMatch?.[1] || undefined,
      resourceId: idMatch ? `R.id.${idMatch[1]}` : undefined,
    });
  }

  // TextView
  const tvRegex = /<(?:\w+\.)*TextView\b[^>]*android:text="([^"]*)"[^>]*/gs;
  while ((m = tvRegex.exec(content)) !== null) {
    const idMatch = m[0].match(/android:id="@\+id\/(\w+)"/);
    elements.push({
      kind: "label",
      text: m[1] || undefined,
      resourceId: idMatch ? `R.id.${idMatch[1]}` : undefined,
    });
  }

  // ImageView
  const imgRegex = /<(?:\w+\.)*ImageView\b[^>]*/gs;
  while ((m = imgRegex.exec(content)) !== null) {
    const descMatch = m[0].match(/android:contentDescription="([^"]*)"/);
    const idMatch = m[0].match(/android:id="@\+id\/(\w+)"/);
    elements.push({
      kind: "image",
      text: descMatch?.[1] || undefined,
      resourceId: idMatch ? `R.id.${idMatch[1]}` : undefined,
    });
  }

  // RecyclerView / ListView
  if (/<(?:\w+\.)*(?:RecyclerView|ListView)\b/.test(content)) {
    elements.push({ kind: "list" });
  }

  // Switch / CheckBox
  const toggleRegex = /<(?:\w+\.)*(?:Switch|SwitchMaterial|CheckBox)\b[^>]*android:text="([^"]*)"[^>]*/gs;
  while ((m = toggleRegex.exec(content)) !== null) {
    elements.push({ kind: "toggle", text: m[1] || undefined });
  }

  if (elements.length === 0) return [];

  return [{
    name,
    filePath,
    platform: "android",
    framework: "android-xml",
    type: "Layout XML",
    elements,
    navigationTargets: [],
  }];
}
