import { describe, it, expect } from "vitest";
import { analyzeKotlinFile, analyzeLayoutXml } from "../analyzers/kotlin-analyzer.js";

describe("analyzeKotlinFile — Compose", () => {
  it("extracts Composable with Button, TextField", () => {
    const result = analyzeKotlinFile("Login.kt", `
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

  it("scopes elements per composable", () => {
    const result = analyzeKotlinFile("Multi.kt", `
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

  it("extracts navigation targets", () => {
    const result = analyzeKotlinFile("Nav.kt", `
@Composable
fun HomeScreen(navController: NavController) {
    Button(onClick = { navController.navigate("settings") }) {
        Text("Go Settings")
    }
}
`);
    expect(result[0].navigationTargets).toContain("settings");
  });

  it("extracts Activity with Intent navigation", () => {
    const result = analyzeKotlinFile("Main.kt", `
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

describe("analyzeLayoutXml", () => {
  it("extracts elements from layout XML", () => {
    const result = analyzeLayoutXml("res/layout/activity_login.xml", `
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">
    <EditText
        android:id="@+id/emailInput"
        android:hint="Email address" />
    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnLogin"
        android:text="Sign In" />
    <TextView
        android:id="@+id/tvWelcome"
        android:text="Welcome back" />
    <ImageView
        android:id="@+id/logo"
        android:contentDescription="App logo" />
    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/recycler" />
</LinearLayout>
`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("activity_login");

    const elements = result[0].elements;
    expect(elements.find((e) => e.kind === "textField" && e.text === "Email address")).toBeTruthy();
    expect(elements.find((e) => e.kind === "button" && e.text === "Sign In")).toBeTruthy();
    expect(elements.find((e) => e.kind === "label" && e.text === "Welcome back")).toBeTruthy();
    expect(elements.find((e) => e.kind === "image" && e.text === "App logo")).toBeTruthy();
    expect(elements.find((e) => e.kind === "list")).toBeTruthy();

    // Check resource IDs
    expect(elements.find((e) => e.resourceId === "R.id.emailInput")).toBeTruthy();
    expect(elements.find((e) => e.resourceId === "R.id.btnLogin")).toBeTruthy();
  });
});
