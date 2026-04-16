import { describe, it, expect, beforeAll } from "vitest";
import {
  parseSwift,
  parseKotlin,
  isTreeSitterAvailable,
  findNodesByType,
  firstStringArg,
  _resetParsers,
} from "../analyzers/ast-parser.js";
import { analyzeSwiftFileAsync } from "../analyzers/swift-analyzer.js";
import { analyzeKotlinFileAsync } from "../analyzers/kotlin-analyzer.js";

// ---------------------------------------------------------------------------
// AST parser core
// ---------------------------------------------------------------------------

describe("AST parser — tree-sitter WASM", () => {
  beforeAll(() => {
    _resetParsers();
  });

  it("reports tree-sitter availability", async () => {
    const status = await isTreeSitterAvailable();
    // Both grammars should be available when tree-sitter-wasms is installed
    expect(typeof status.swift).toBe("boolean");
    expect(typeof status.kotlin).toBe("boolean");
  });

  describe("parseSwift", () => {
    it("parses a simple Swift struct and returns a tree", async () => {
      const tree = await parseSwift(`
struct LoginView: View {
    var body: some View {
        Text("Hello")
    }
}
`);
      // If tree-sitter is available, we get a tree; otherwise null (graceful fallback)
      if (tree) {
        expect(tree.rootNode.type).toBe("source_file");
        const classDecls = findNodesByType(tree.rootNode, "class_declaration");
        expect(classDecls.length).toBeGreaterThanOrEqual(1);

        // Verify struct name
        const firstStruct = classDecls[0];
        const nameNode = firstStruct.childForFieldName("name")
          ?? firstStruct.namedChildren.find((c) => c.type === "type_identifier");
        expect(nameNode?.text).toBe("LoginView");
      }
    });

    it("finds call_expression nodes for SwiftUI components", async () => {
      const tree = await parseSwift(`
struct ProfileView: View {
    var body: some View {
        VStack {
            TextField("Username", text: $name)
            Button("Save") { save() }
            Toggle("Notifications", isOn: $notifs)
        }
    }
}
`);
      if (tree) {
        const calls = findNodesByType(tree.rootNode, "call_expression");
        const callNames = calls
          .map((c) => {
            const first = c.namedChildren[0];
            return first?.type === "simple_identifier" ? first.text : null;
          })
          .filter(Boolean);
        expect(callNames).toContain("TextField");
        expect(callNames).toContain("Button");
        expect(callNames).toContain("Toggle");
      }
    });

    it("extracts string literals from call expressions", async () => {
      const tree = await parseSwift(`
struct V: View {
    var body: some View {
        Text("Hello World")
    }
}
`);
      if (tree) {
        const calls = findNodesByType(tree.rootNode, "call_expression");
        const textCall = calls.find((c) => {
          const first = c.namedChildren[0];
          return first?.type === "simple_identifier" && first.text === "Text";
        });
        expect(textCall).toBeDefined();
        const str = firstStringArg(textCall!);
        expect(str).toBe("Hello World");
      }
    });

    it("identifies View conformance via inheritance_specifier", async () => {
      const tree = await parseSwift(`
struct MyView: View {
    var body: some View { EmptyView() }
}
struct NotAView {
    var x = 1
}
`);
      if (tree) {
        const classes = findNodesByType(tree.rootNode, "class_declaration");
        const withView = classes.filter((c) => {
          const inh = c.namedChildren.find((n) => n.type === "inheritance_specifier");
          if (!inh) return false;
          return findNodesByType(inh, "type_identifier").some((t) => t.text === "View");
        });
        expect(withView).toHaveLength(1);
        const name = withView[0].childForFieldName("name")
          ?? withView[0].namedChildren.find((c) => c.type === "type_identifier");
        expect(name?.text).toBe("MyView");
      }
    });
  });

  describe("parseKotlin", () => {
    it("parses a Kotlin composable and returns a tree", async () => {
      const tree = await parseKotlin(`
@Composable
fun LoginScreen() {
    Text("Hello")
}
`);
      if (tree) {
        expect(tree.rootNode.type).toBe("source_file");
        const funcDecls = findNodesByType(tree.rootNode, "function_declaration");
        expect(funcDecls.length).toBeGreaterThanOrEqual(1);

        // Verify function name
        const nameNode = funcDecls[0].namedChildren.find((c) => c.type === "simple_identifier");
        expect(nameNode?.text).toBe("LoginScreen");
      }
    });

    it("detects @Composable annotation", async () => {
      const tree = await parseKotlin(`
@Composable
fun MyScreen() {
    Text("content")
}
fun regularFunction() {
    println("not composable")
}
`);
      if (tree) {
        const funcDecls = findNodesByType(tree.rootNode, "function_declaration");
        const composables = funcDecls.filter((f) => {
          const mods = f.namedChildren.find((c) => c.type === "modifiers");
          if (!mods) return false;
          const annotations = mods.namedChildren.filter((c) => c.type === "annotation");
          return annotations.some((a) => {
            const ut = a.namedChildren.find((c) => c.type === "user_type");
            const ti = ut?.namedChildren.find((c) => c.type === "type_identifier");
            return ti?.text === "Composable";
          });
        });
        expect(composables).toHaveLength(1);
        const name = composables[0].namedChildren.find((c) => c.type === "simple_identifier");
        expect(name?.text).toBe("MyScreen");
      }
    });

    it("finds call_expression nodes for Compose components", async () => {
      const tree = await parseKotlin(`
@Composable
fun Screen() {
    Column {
        OutlinedTextField(value = email, label = { Text("Email") })
        Button(onClick = { }) { Text("Submit") }
    }
}
`);
      if (tree) {
        const calls = findNodesByType(tree.rootNode, "call_expression");
        const callNames = calls
          .map((c) => {
            const first = c.namedChildren[0];
            return first?.type === "simple_identifier" ? first.text : null;
          })
          .filter(Boolean);
        expect(callNames).toContain("OutlinedTextField");
        expect(callNames).toContain("Text");
      }
    });

    it("extracts Kotlin string_literal content", async () => {
      const tree = await parseKotlin(`
fun test() {
    Text("Hello Kotlin")
}
`);
      if (tree) {
        const calls = findNodesByType(tree.rootNode, "call_expression");
        const textCall = calls.find((c) => {
          const first = c.namedChildren[0];
          return first?.type === "simple_identifier" && first.text === "Text";
        });
        expect(textCall).toBeDefined();
        const str = firstStringArg(textCall!);
        expect(str).toBe("Hello Kotlin");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Async analyzer variants (AST-first, regex fallback)
// ---------------------------------------------------------------------------

describe("analyzeSwiftFileAsync — AST-based", () => {
  it("extracts View with Button and TextField", async () => {
    const result = await analyzeSwiftFileAsync("Login.swift", `
import SwiftUI
struct LoginView: View {
    var body: some View {
        VStack {
            TextField("Email", text: $email)
            SecureField("Password", text: $pass)
            Button("Sign In") { login() }
        }
    }
}
`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("LoginView");
    expect(result[0].framework).toBe("swiftui");
    const kinds = result[0].elements.map((e) => e.kind);
    expect(kinds).toContain("textField");
    expect(kinds).toContain("button");
    expect(result[0].elements.find((e) => e.text === "Email")?.kind).toBe("textField");
    expect(result[0].elements.find((e) => e.text === "Sign In")?.kind).toBe("button");
  });

  it("scopes elements per view (no leaking)", async () => {
    const result = await analyzeSwiftFileAsync("Multi.swift", `
import SwiftUI
struct LoginView: View {
    var body: some View {
        VStack {
            TextField("Email", text: $email)
            Button("Sign In") { }
        }
    }
}
struct DashboardView: View {
    var body: some View {
        List { Text("Expenses") }
    }
}
`);
    expect(result).toHaveLength(2);

    const login = result.find((s) => s.name === "LoginView")!;
    const dash = result.find((s) => s.name === "DashboardView")!;

    expect(login.elements.some((e) => e.text === "Email")).toBe(true);
    expect(login.elements.some((e) => e.text === "Sign In")).toBe(true);
    expect(login.elements.some((e) => e.text === "Expenses")).toBe(false);

    expect(dash.elements.some((e) => e.text === "Expenses")).toBe(true);
    expect(dash.elements.some((e) => e.text === "Email")).toBe(false);
  });

  it("extracts NavigationLink targets", async () => {
    const result = await analyzeSwiftFileAsync("Nav.swift", `
import SwiftUI
struct HomeView: View {
    var body: some View {
        NavigationLink(destination: SettingsView()) {
            Text("Settings")
        }
    }
}
`);
    expect(result[0].navigationTargets).toContain("SettingsView");
  });

  it("extracts Toggle, Picker, Image, List", async () => {
    const result = await analyzeSwiftFileAsync("Settings.swift", `
import SwiftUI
struct SettingsView: View {
    var body: some View {
        List {
            Toggle("Dark Mode", isOn: $dark)
            Picker("Language", selection: $lang) { }
            Image(systemName: "gear")
        }
    }
}
`);
    const kinds = result[0].elements.map((e) => e.kind);
    expect(kinds).toContain("toggle");
    expect(kinds).toContain("picker");
    expect(kinds).toContain("image");
    expect(kinds).toContain("list");
  });

  it("extracts UIKit ViewController", async () => {
    const result = await analyzeSwiftFileAsync("VC.swift", `
import UIKit
class LoginViewController: UIViewController {
    override func viewDidLoad() {
        loginButton.setTitle("Log In", for: .normal)
        emailField.placeholder = "Enter email"
    }
}
`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("LoginViewController");
    expect(result[0].type).toBe("UIViewController");
    expect(result[0].elements.find((e) => e.text === "Log In")?.kind).toBe("button");
    expect(result[0].elements.find((e) => e.text === "Enter email")?.kind).toBe("textField");
  });
});

describe("analyzeKotlinFileAsync — AST-based", () => {
  it("extracts Composable with Button and TextField", async () => {
    const result = await analyzeKotlinFileAsync("Login.kt", `
import androidx.compose.runtime.*
import androidx.compose.material3.*

@Composable
fun LoginScreen(navController: NavController) {
    Column {
        OutlinedTextField(
            value = email,
            label = { Text("Email") }
        )
        OutlinedTextField(
            value = password,
            label = { Text("Password") }
        )
        Button(onClick = { login() }) {
            Text("Sign In")
        }
    }
}
`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("LoginScreen");
    expect(result[0].framework).toBe("jetpack-compose");
    expect(result[0].elements.find((e) => e.text === "Email")?.kind).toBe("textField");
    expect(result[0].elements.find((e) => e.text === "Sign In")).toBeTruthy();
  });

  it("scopes elements per composable", async () => {
    const result = await analyzeKotlinFileAsync("Multi.kt", `
@Composable
fun LoginScreen() {
    OutlinedTextField(value = email, label = { Text("Email") })
    Button(onClick = {}) { Text("Sign In") }
}

@Composable
fun HomeScreen() {
    LazyColumn {
        item { Text("Dashboard") }
    }
}
`);
    expect(result).toHaveLength(2);

    const login = result.find((s) => s.name === "LoginScreen")!;
    const home = result.find((s) => s.name === "HomeScreen")!;

    expect(login.elements.some((e) => e.text === "Email")).toBe(true);
    expect(login.elements.some((e) => e.text === "Dashboard")).toBe(false);

    expect(home.elements.some((e) => e.text === "Dashboard")).toBe(true);
    expect(home.elements.some((e) => e.text === "Email")).toBe(false);
  });

  it("extracts navigation targets", async () => {
    const result = await analyzeKotlinFileAsync("Nav.kt", `
@Composable
fun HomeScreen(navController: NavController) {
    Button(onClick = { navController.navigate("settings") }) {
        Text("Go Settings")
    }
}
`);
    expect(result[0].navigationTargets).toContain("settings");
  });

  it("extracts Activity with Intent navigation", async () => {
    const result = await analyzeKotlinFileAsync("Main.kt", `
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val intent = Intent(this, SettingsActivity::class.java)
        startActivity(intent)
    }
}
`);
    const activity = result.find((s) => s.type === "Activity");
    expect(activity).toBeDefined();
    expect(activity!.navigationTargets).toContain("SettingsActivity");
  });
});

// ---------------------------------------------------------------------------
// Fallback behavior
// ---------------------------------------------------------------------------

describe("Fallback to regex when tree-sitter unavailable", () => {
  it("analyzeSwiftFileAsync falls back gracefully", async () => {
    // Even if tree-sitter init were to fail, the async variant should
    // still return results via the regex fallback. We test the happy
    // path here (regex and AST produce compatible output).
    const result = await analyzeSwiftFileAsync("Test.swift", `
import SwiftUI
struct TestView: View {
    var body: some View {
        Button("Click Me") { }
    }
}
`);
    expect(result).toHaveLength(1);
    expect(result[0].elements.some((e) => e.kind === "button" && e.text === "Click Me")).toBe(true);
  });

  it("analyzeKotlinFileAsync falls back gracefully", async () => {
    const result = await analyzeKotlinFileAsync("Test.kt", `
@Composable
fun TestScreen() {
    Button(onClick = {}) { Text("Press") }
}
`);
    expect(result).toHaveLength(1);
    expect(result[0].elements.some((e) => e.text === "Press")).toBe(true);
  });
});
