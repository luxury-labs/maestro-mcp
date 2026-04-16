import { describe, it, expect } from "vitest";
import { MaestroCli } from "../maestro/cli.js";

describe("MaestroCli.detectPlatform", () => {
  it("UUID → ios", () => {
    expect(MaestroCli.detectPlatform("3BE15928-5206-4616-9A27-D6E785D4138F")).toBe("ios");
  });

  it("lowercase UUID → ios", () => {
    expect(MaestroCli.detectPlatform("3be15928-5206-4616-9a27-d6e785d4138f")).toBe("ios");
  });

  it("emulator-5554 → android", () => {
    expect(MaestroCli.detectPlatform("emulator-5554")).toBe("android");
  });

  it("TCP device → android", () => {
    expect(MaestroCli.detectPlatform("192.168.1.100:5555")).toBe("android");
  });

  it("random string → android", () => {
    expect(MaestroCli.detectPlatform("some-device")).toBe("android");
  });
});
