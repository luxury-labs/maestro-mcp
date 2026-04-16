/**
 * AST-based source code parsing using web-tree-sitter (WASM).
 *
 * Provides lazy-initialized parsers for Swift and Kotlin that fall back
 * gracefully when the WASM runtime or grammar files are unavailable.
 */

// web-tree-sitter types are declared as a module ('web-tree-sitter').
// We use dynamic import only, so we define minimal interfaces here to
// avoid compile-time dependency on the module's namespace shape.

/** Minimal SyntaxNode interface matching web-tree-sitter's Node class */
export interface SyntaxNode {
  type: string;
  text: string;
  namedChildren: SyntaxNode[];
  namedChildCount: number;
  namedChild(index: number): SyntaxNode;
  firstChild: SyntaxNode | null;
  parent: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  walk(): TreeCursor;
}

interface TreeCursor {
  currentNode: SyntaxNode;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

/** Minimal Tree interface */
export interface Tree {
  rootNode: SyntaxNode;
}

/** Parser instance (created via new Parser()) */
interface ParserInstance {
  parse(source: string): Tree;
  setLanguage(lang: unknown): void;
}

/** Parser constructor & static methods */
interface ParserClass {
  new (): ParserInstance;
  init(opts?: unknown): Promise<void>;
  Language: {
    load(path: string): Promise<unknown>;
  };
}

/** Singleton state — initialized at most once per process. */
let _Parser: ParserClass | null = null;
let _swiftParser: ParserInstance | null = null;
let _kotlinParser: ParserInstance | null = null;
let _initFailed = false;

/**
 * Dynamically import web-tree-sitter and call `init()`.
 * Returns the Parser class, or null if the module is missing.
 */
async function loadTreeSitter(): Promise<ParserClass | null> {
  if (_Parser) return _Parser;
  if (_initFailed) return null;

  try {
    const mod = await import("web-tree-sitter");
    const Parser = (mod.default ?? mod) as unknown as ParserClass;
    await Parser.init();
    _Parser = Parser;
    return Parser;
  } catch {
    _initFailed = true;
    return null;
  }
}

/**
 * Resolve the filesystem path to a grammar `.wasm` file.
 */
function resolveGrammarPath(language: "swift" | "kotlin"): string | null {
  const fileName = `tree-sitter-${language}.wasm`;

  try {
    const fsSync = require("node:fs") as typeof import("node:fs");
    const pathMod = require("node:path") as typeof import("node:path");

    // Strategy 1: tree-sitter-wasms package
    try {
      const wasmsPkg = require.resolve("tree-sitter-wasms/package.json");
      const wasmsDir = pathMod.dirname(wasmsPkg);
      const candidates = [
        pathMod.join(wasmsDir, "out", fileName),
        pathMod.join(wasmsDir, fileName),
      ];
      for (const p of candidates) {
        if (fsSync.existsSync(p)) return p;
      }
    } catch {
      // Package not installed
    }

    // Strategy 2: local grammars directory
    const localPath = pathMod.join(__dirname, "grammars", fileName);
    if (fsSync.existsSync(localPath)) return localPath;

    const srcPath = pathMod.resolve(__dirname, "..", "..", "src", "analyzers", "grammars", fileName);
    if (fsSync.existsSync(srcPath)) return srcPath;
  } catch {
    // ignore
  }

  return null;
}

/**
 * Get (or create) a tree-sitter parser for the given language.
 * Returns null if tree-sitter or the grammar is unavailable.
 */
async function getParser(language: "swift" | "kotlin"): Promise<ParserInstance | null> {
  const cached = language === "swift" ? _swiftParser : _kotlinParser;
  if (cached) return cached;

  const Parser = await loadTreeSitter();
  if (!Parser) return null;

  const grammarPath = resolveGrammarPath(language);
  if (!grammarPath) return null;

  try {
    const lang = await Parser.Language.load(grammarPath);
    const parser = new Parser();
    parser.setLanguage(lang);

    if (language === "swift") {
      _swiftParser = parser;
    } else {
      _kotlinParser = parser;
    }
    return parser;
  } catch {
    return null;
  }
}

/**
 * Parse Swift source code into an AST.
 * Returns null if tree-sitter is unavailable.
 */
export async function parseSwift(source: string): Promise<Tree | null> {
  const parser = await getParser("swift");
  if (!parser) return null;
  return parser.parse(source);
}

/**
 * Parse Kotlin source code into an AST.
 * Returns null if tree-sitter is unavailable.
 */
export async function parseKotlin(source: string): Promise<Tree | null> {
  const parser = await getParser("kotlin");
  if (!parser) return null;
  return parser.parse(source);
}

/**
 * Check whether tree-sitter is available (grammar files present).
 */
export async function isTreeSitterAvailable(): Promise<{
  swift: boolean;
  kotlin: boolean;
}> {
  const [swiftParser, kotlinParser] = await Promise.all([
    getParser("swift"),
    getParser("kotlin"),
  ]);
  return {
    swift: swiftParser !== null,
    kotlin: kotlinParser !== null,
  };
}

// ---------------------------------------------------------------------------
// AST query helpers
// ---------------------------------------------------------------------------

/**
 * Collect all descendant nodes matching a predicate.
 */
export function findNodes(
  root: SyntaxNode,
  predicate: (node: SyntaxNode) => boolean,
): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  const cursor = root.walk();
  let reachedEnd = false;

  while (!reachedEnd) {
    if (predicate(cursor.currentNode)) {
      results.push(cursor.currentNode);
    }

    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;

    while (true) {
      if (!cursor.gotoParent()) {
        reachedEnd = true;
        break;
      }
      if (cursor.gotoNextSibling()) break;
    }
  }

  return results;
}

/**
 * Collect all descendant nodes whose `type` matches the given value.
 */
export function findNodesByType(root: SyntaxNode, type: string): SyntaxNode[] {
  return findNodes(root, (n) => n.type === type);
}

/**
 * Extract the first string literal argument from a call expression node.
 */
export function firstStringArg(callNode: SyntaxNode): string | null {
  const strings = findNodes(
    callNode,
    (n) => n.type === "string_literal" || n.type === "line_string_literal",
  );
  for (const s of strings) {
    const textChild = s.namedChildren.find(
      (c: SyntaxNode) =>
        c.type === "string_content" ||
        c.type === "line_str_text" ||
        c.type === "string_fragment",
    );
    if (textChild) return textChild.text;
    const raw = s.text;
    if (raw.startsWith('"') && raw.endsWith('"')) {
      return raw.slice(1, -1);
    }
  }
  return null;
}

/**
 * Find a named argument's string value in a call expression.
 */
export function namedArgStringValue(
  callNode: SyntaxNode,
  argName: string,
): string | null {
  for (const child of callNode.namedChildren) {
    if (child.text.startsWith(argName)) {
      const str = firstStringArg(child);
      if (str) return str;
    }
  }
  return null;
}

/**
 * Reset parser state (for testing purposes).
 */
export function _resetParsers(): void {
  _Parser = null;
  _swiftParser = null;
  _kotlinParser = null;
  _initFailed = false;
}
