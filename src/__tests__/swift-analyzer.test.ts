import { describe, it, expect } from "vitest";
import { analyzeSwiftFile } from "../analyzers/swift-analyzer.js";

describe("analyzeSwiftFile — SwiftUI", () => {
  it("extracts View with Button, TextField", () => {
    const result = analyzeSwiftFile("Login.swift", `
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

  it("scopes elements per view (no leaking)", () => {
    const result = analyzeSwiftFile("Multi.swift", `
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

  it("extracts NavigationLink targets", () => {
    const result = analyzeSwiftFile("Nav.swift", `
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

  it("extracts Toggle, Picker, Image, List", () => {
    const result = analyzeSwiftFile("Settings.swift", `
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
});

describe("analyzeSwiftFile — UIKit", () => {
  it("extracts UIViewController", () => {
    const result = analyzeSwiftFile("VC.swift", `
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
