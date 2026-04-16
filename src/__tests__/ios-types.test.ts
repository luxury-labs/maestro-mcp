import { describe, it, expect } from "vitest";
import type {
  PrivacyService,
  PrivacyAction,
  StatusBarOverrides,
  PushPayload,
} from "../maestro/ios-types.js";

describe("iOS types compile-time validation", () => {
  it("PrivacyService accepts valid values", () => {
    const services: PrivacyService[] = [
      "all", "camera", "location", "microphone", "photos",
      "contacts", "calendar", "reminders", "siri", "motion",
      "location-always", "contacts-limited", "photos-add", "media-library",
    ];
    expect(services).toHaveLength(14);
  });

  it("PrivacyAction accepts valid values", () => {
    const actions: PrivacyAction[] = ["grant", "revoke", "reset"];
    expect(actions).toHaveLength(3);
  });

  it("StatusBarOverrides accepts all fields", () => {
    const overrides: StatusBarOverrides = {
      time: "9:41",
      dataNetwork: "5g",
      wifiMode: "active",
      wifiBars: 3,
      cellularMode: "active",
      cellularBars: 4,
      batteryState: "charged",
      batteryLevel: 100,
      operatorName: "Test",
    };
    expect(overrides.time).toBe("9:41");
    expect(overrides.batteryLevel).toBe(100);
  });

  it("PushPayload accepts APNs structure", () => {
    const payload: PushPayload = {
      aps: {
        alert: { title: "Test", body: "Hello", subtitle: "Sub" },
        badge: 5,
        sound: "default",
      },
      customField: "value",
    };
    expect(payload.aps.badge).toBe(5);
    expect(payload.customField).toBe("value");
  });
});
