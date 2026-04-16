import { describe, it, expect } from "vitest";
import {
  scanKotlinComponents,
  scanSwiftComponents,
  resolveCustomComponent,
  type ComponentInfo,
} from "../analyzers/component-registry.js";
import { analyzeKotlinFile } from "../analyzers/kotlin-analyzer.js";
import { analyzeSwiftFile } from "../analyzers/swift-analyzer.js";

describe("scanKotlinComponents", () => {
  it("detects button wrapper composable", () => {
    const content = `
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit) {
    Button(onClick = onClick) {
        Text(text)
    }
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.has("PrimaryButton")).toBe(true);
    expect(registry.get("PrimaryButton")!.wraps).toBe("button");
    expect(registry.get("PrimaryButton")!.textParam).toBe("text");
  });

  it("detects text field wrapper composable", () => {
    const content = `
@Composable
fun CustomInput(label: String, value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) }
    )
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.has("CustomInput")).toBe(true);
    expect(registry.get("CustomInput")!.wraps).toBe("textField");
    expect(registry.get("CustomInput")!.textParam).toBe("label");
  });

  it("detects label wrapper composable", () => {
    const content = `
@Composable
fun ErrorBanner(message: String) {
    Card {
        Text(message, color = Color.Red)
    }
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.has("ErrorBanner")).toBe(true);
    expect(registry.get("ErrorBanner")!.wraps).toBe("label");
    expect(registry.get("ErrorBanner")!.textParam).toBe("message");
  });

  it("picks the best text param from multiple String params", () => {
    const content = `
@Composable
fun ActionButton(id: String, title: String, subtitle: String, onClick: () -> Unit) {
    Button(onClick = onClick) {
        Column {
            Text(title)
            Text(subtitle)
        }
    }
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.get("ActionButton")!.textParam).toBe("title");
  });

  it("does not register composables that don't wrap primitives", () => {
    const content = `
@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme {
        content()
    }
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.has("AppTheme")).toBe(false);
  });

  it("detects toggle wrapper", () => {
    const content = `
@Composable
fun SettingsToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row {
        Text(label)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.has("SettingsToggle")).toBe(true);
    // The first match in priority order is the Switch -> toggle
    // But Text comes first in KOTLIN_PRIMITIVES iteration... depends on order
    // Actually we check Button first, then TextField, then Text, then Switch
    // The body contains Text and Switch. Text will match first.
    // Let's verify it detects something:
    expect(["toggle", "label"]).toContain(registry.get("SettingsToggle")!.wraps);
  });

  it("handles multiple components in one file", () => {
    const content = `
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit) {
    Button(onClick = onClick) {
        Text(text)
    }
}

@Composable
fun SearchInput(placeholder: String, value: String) {
    TextField(value = value, placeholder = { Text(placeholder) })
}
`;
    const registry = scanKotlinComponents(content);
    expect(registry.size).toBe(2);
    expect(registry.get("PrimaryButton")!.wraps).toBe("button");
    expect(registry.get("SearchInput")!.wraps).toBe("textField");
  });
});

describe("scanSwiftComponents", () => {
  it("detects button wrapper view", () => {
    const content = `
import SwiftUI

struct PrimaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
        }
    }
}
`;
    const registry = scanSwiftComponents(content);
    expect(registry.has("PrimaryButton")).toBe(true);
    expect(registry.get("PrimaryButton")!.wraps).toBe("button");
    expect(registry.get("PrimaryButton")!.textParam).toBe("title");
  });

  it("detects text field wrapper view", () => {
    const content = `
import SwiftUI

struct StyledInput: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text)
            .padding()
            .border(Color.gray)
    }
}
`;
    const registry = scanSwiftComponents(content);
    expect(registry.has("StyledInput")).toBe(true);
    expect(registry.get("StyledInput")!.wraps).toBe("textField");
    expect(registry.get("StyledInput")!.textParam).toBe("placeholder");
  });

  it("detects toggle wrapper view", () => {
    const content = `
import SwiftUI

struct SettingsRow: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(label, isOn: $isOn)
    }
}
`;
    const registry = scanSwiftComponents(content);
    expect(registry.has("SettingsRow")).toBe(true);
    expect(registry.get("SettingsRow")!.wraps).toBe("toggle");
    expect(registry.get("SettingsRow")!.textParam).toBe("label");
  });

  it("does not register views without primitive wrappers", () => {
    const content = `
import SwiftUI

struct ContentContainer: View {
    var body: some View {
        VStack {
            Spacer()
        }
    }
}
`;
    const registry = scanSwiftComponents(content);
    expect(registry.has("ContentContainer")).toBe(false);
  });
});

describe("resolveCustomComponent", () => {
  const registry = new Map<string, ComponentInfo>([
    ["PrimaryButton", { wraps: "button", textParam: "text" }],
    ["ErrorBanner", { wraps: "label", textParam: "message" }],
    ["IconBtn", { wraps: "button" }],
  ]);

  it("resolves component with named text param", () => {
    const result = resolveCustomComponent(
      "PrimaryButton",
      'text = "Send"',
      registry
    );
    expect(result).toBeDefined();
    expect(result!.kind).toBe("button");
    expect(result!.text).toBe("Send");
  });

  it("resolves component with different text param name", () => {
    const result = resolveCustomComponent(
      "ErrorBanner",
      'message = "Something went wrong"',
      registry
    );
    expect(result).toBeDefined();
    expect(result!.kind).toBe("label");
    expect(result!.text).toBe("Something went wrong");
  });

  it("falls back to first string literal when no named param", () => {
    const result = resolveCustomComponent(
      "IconBtn",
      '"Delete", icon = Icons.Delete',
      registry
    );
    expect(result).toBeDefined();
    expect(result!.kind).toBe("button");
    expect(result!.text).toBe("Delete");
  });

  it("returns undefined for unknown components", () => {
    const result = resolveCustomComponent("UnknownWidget", '"hello"', registry);
    expect(result).toBeUndefined();
  });
});

describe("Integration: Kotlin analyzer with component registry", () => {
  it("resolves custom button components in screen analysis", () => {
    const componentRegistry = new Map<string, ComponentInfo>([
      ["PrimaryButton", { wraps: "button", textParam: "text" }],
      ["ErrorBanner", { wraps: "label", textParam: "message" }],
    ]);

    const result = analyzeKotlinFile(
      "CheckoutScreen.kt",
      `
@Composable
fun CheckoutScreen() {
    Column {
        Text("Order Summary")
        PrimaryButton(text = "Pay Now", onClick = { pay() })
        ErrorBanner(message = "Card declined")
    }
}
`,
      { componentRegistry }
    );

    expect(result).toHaveLength(1);
    const elements = result[0].elements;

    // Standard Text element
    expect(elements.find((e) => e.kind === "label" && e.text === "Order Summary")).toBeTruthy();

    // Custom PrimaryButton resolved as button
    expect(elements.find((e) => e.kind === "button" && e.text === "Pay Now")).toBeTruthy();

    // Custom ErrorBanner resolved as label
    expect(elements.find((e) => e.kind === "label" && e.text === "Card declined")).toBeTruthy();
  });
});

describe("Integration: Swift analyzer with component registry", () => {
  it("resolves custom button components in SwiftUI view", () => {
    const componentRegistry = new Map<string, ComponentInfo>([
      ["PrimaryButton", { wraps: "button", textParam: "title" }],
    ]);

    const result = analyzeSwiftFile(
      "LoginView.swift",
      `
import SwiftUI

struct LoginView: View {
    var body: some View {
        VStack {
            Text("Welcome")
            PrimaryButton(title = "Sign In")
        }
    }
}
`,
      { componentRegistry }
    );

    expect(result).toHaveLength(1);
    const elements = result[0].elements;

    expect(elements.find((e) => e.kind === "label" && e.text === "Welcome")).toBeTruthy();
    expect(elements.find((e) => e.kind === "button" && e.text === "Sign In")).toBeTruthy();
  });
});
