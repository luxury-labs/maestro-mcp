import { describe, it, expect } from "vitest";
import {
  parseStringsXml,
  parseLocalizableStrings,
  resolveStringRef,
} from "../analyzers/string-resolver.js";
import { analyzeKotlinFile } from "../analyzers/kotlin-analyzer.js";

describe("parseStringsXml", () => {
  it("parses simple strings", () => {
    const xml = `
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Mi App</string>
    <string name="phone_title">Tu n\u00famero de tel\u00e9fono</string>
    <string name="welcome_msg">Bienvenido a la app</string>
</resources>`;
    const map = parseStringsXml(xml);
    expect(map.get("app_name")).toBe("Mi App");
    expect(map.get("phone_title")).toBe("Tu n\u00famero de tel\u00e9fono");
    expect(map.get("welcome_msg")).toBe("Bienvenido a la app");
  });

  it("handles XML entities and Android escapes", () => {
    const xml = `
<resources>
    <string name="terms">Terms &amp; Conditions</string>
    <string name="quote">She said \\"hello\\"</string>
    <string name="apostrophe">It\\'s working</string>
    <string name="html">&lt;b&gt;Bold&lt;/b&gt;</string>
</resources>`;
    const map = parseStringsXml(xml);
    expect(map.get("terms")).toBe("Terms & Conditions");
    expect(map.get("quote")).toBe('She said "hello"');
    expect(map.get("apostrophe")).toBe("It's working");
    expect(map.get("html")).toBe("<b>Bold</b>");
  });

  it("handles translatable=false attribute", () => {
    const xml = `
<resources>
    <string name="app_name" translatable="false">MyApp</string>
</resources>`;
    const map = parseStringsXml(xml);
    expect(map.get("app_name")).toBe("MyApp");
  });

  it("extracts first item from string-array", () => {
    const xml = `
<resources>
    <string-array name="planets">
        <item>Mercury</item>
        <item>Venus</item>
        <item>Earth</item>
    </string-array>
</resources>`;
    const map = parseStringsXml(xml);
    expect(map.get("planets")).toBe("Mercury");
  });

  it("skips plurals gracefully", () => {
    const xml = `
<resources>
    <plurals name="items_count">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
    <string name="title">Home</string>
</resources>`;
    const map = parseStringsXml(xml);
    expect(map.has("items_count")).toBe(false);
    expect(map.get("title")).toBe("Home");
  });

  it("handles multiline string values", () => {
    const xml = `
<resources>
    <string name="long_text">This is a
multiline string
value</string>
</resources>`;
    const map = parseStringsXml(xml);
    expect(map.get("long_text")).toBe("This is a\nmultiline string\nvalue");
  });

  it("returns empty map for empty/invalid content", () => {
    expect(parseStringsXml("")).toEqual(new Map());
    expect(parseStringsXml("not xml")).toEqual(new Map());
  });
});

describe("parseLocalizableStrings", () => {
  it("parses standard format", () => {
    const content = `
/* Login screen */
"login_title" = "Iniciar sesi\u00f3n";
"login_button" = "Entrar";
"forgot_password" = "\u00bfOlvidaste tu contrase\u00f1a?";
`;
    const map = parseLocalizableStrings(content);
    expect(map.get("login_title")).toBe("Iniciar sesi\u00f3n");
    expect(map.get("login_button")).toBe("Entrar");
    expect(map.get("forgot_password")).toBe("\u00bfOlvidaste tu contrase\u00f1a?");
  });

  it("handles escape sequences", () => {
    const content = `
"escaped_quote" = "She said \\"hello\\"";
"newline" = "Line1\\nLine2";
"tab" = "Col1\\tCol2";
"backslash" = "path\\\\to\\\\file";
`;
    const map = parseLocalizableStrings(content);
    expect(map.get("escaped_quote")).toBe('She said "hello"');
    expect(map.get("newline")).toBe("Line1\nLine2");
    expect(map.get("tab")).toBe("Col1\tCol2");
    expect(map.get("backslash")).toBe("path\\to\\file");
  });

  it("returns empty map for empty content", () => {
    expect(parseLocalizableStrings("")).toEqual(new Map());
  });

  it("ignores comment-only lines", () => {
    const content = `
/* This is a comment */
// Another comment
"key" = "value";
`;
    const map = parseLocalizableStrings(content);
    expect(map.size).toBe(1);
    expect(map.get("key")).toBe("value");
  });
});

describe("resolveStringRef", () => {
  const stringMap = new Map<string, string>([
    ["phone_title", "Tu n\u00famero de tel\u00e9fono"],
    ["app_name", "Mi App"],
    ["login_button", "Entrar"],
  ]);

  it("resolves Android R.string references", () => {
    expect(resolveStringRef("R.string.phone_title", stringMap)).toBe("Tu n\u00famero de tel\u00e9fono");
    expect(resolveStringRef("R.string.app_name", stringMap)).toBe("Mi App");
  });

  it("resolves direct key lookup (iOS)", () => {
    expect(resolveStringRef("login_button", stringMap)).toBe("Entrar");
  });

  it("returns undefined for missing keys", () => {
    expect(resolveStringRef("R.string.nonexistent", stringMap)).toBeUndefined();
    expect(resolveStringRef("missing_key", stringMap)).toBeUndefined();
  });

  it("returns undefined for malformed refs", () => {
    expect(resolveStringRef("R.drawable.icon", stringMap)).toBeUndefined();
    expect(resolveStringRef("", stringMap)).toBeUndefined();
  });
});

describe("Kotlin analyzer with string resolution", () => {
  it("resolves R.string references in Compose elements", () => {
    const stringMap = new Map<string, string>([
      ["phone_title", "Tu n\u00famero de tel\u00e9fono"],
      ["submit_btn", "Enviar"],
    ]);

    const result = analyzeKotlinFile(
      "PhoneScreen.kt",
      `
import androidx.compose.runtime.*
import androidx.compose.material3.*

@Composable
fun PhoneScreen() {
    Column {
        Text(stringResource(R.string.phone_title))
        Button(onClick = {}) {
            Text("Enviar")
        }
    }
}
`,
      { stringMap }
    );

    expect(result).toHaveLength(1);
    const phoneLabel = result[0].elements.find(
      (e) => e.resourceId === "R.string.phone_title"
    );
    expect(phoneLabel).toBeDefined();
    expect(phoneLabel!.resolvedText).toBe("Tu n\u00famero de tel\u00e9fono");

    // Non-resource elements should not have resolvedText
    const button = result[0].elements.find((e) => e.text === "Enviar");
    expect(button).toBeDefined();
    expect(button!.resolvedText).toBeUndefined();
  });

  it("leaves resolvedText undefined when key is missing from map", () => {
    const stringMap = new Map<string, string>();

    const result = analyzeKotlinFile(
      "Screen.kt",
      `
@Composable
fun TestScreen() {
    Text(stringResource(R.string.unknown_key))
}
`,
      { stringMap }
    );

    const label = result[0].elements.find(
      (e) => e.resourceId === "R.string.unknown_key"
    );
    expect(label).toBeDefined();
    expect(label!.resolvedText).toBeUndefined();
  });
});
