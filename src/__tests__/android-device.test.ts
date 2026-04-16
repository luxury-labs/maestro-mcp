import { describe, it, expect } from "vitest";
import { ANDROID_PERMISSIONS } from "../maestro/android-device.js";

describe("ANDROID_PERMISSIONS mapping", () => {
  it("maps camera to CAMERA", () => {
    expect(ANDROID_PERMISSIONS["camera"]).toBe("android.permission.CAMERA");
  });

  it("maps location to ACCESS_FINE_LOCATION", () => {
    expect(ANDROID_PERMISSIONS["location"]).toBe("android.permission.ACCESS_FINE_LOCATION");
  });

  it("maps location-always to ACCESS_BACKGROUND_LOCATION", () => {
    expect(ANDROID_PERMISSIONS["location-always"]).toBe("android.permission.ACCESS_BACKGROUND_LOCATION");
  });

  it("maps microphone to RECORD_AUDIO", () => {
    expect(ANDROID_PERMISSIONS["microphone"]).toBe("android.permission.RECORD_AUDIO");
  });

  it("maps photos to READ_MEDIA_IMAGES", () => {
    expect(ANDROID_PERMISSIONS["photos"]).toBe("android.permission.READ_MEDIA_IMAGES");
  });

  it("maps contacts to READ_CONTACTS", () => {
    expect(ANDROID_PERMISSIONS["contacts"]).toBe("android.permission.READ_CONTACTS");
  });

  it("maps calendar to READ_CALENDAR", () => {
    expect(ANDROID_PERMISSIONS["calendar"]).toBe("android.permission.READ_CALENDAR");
  });

  it("has no mapping for unknown service", () => {
    expect(ANDROID_PERMISSIONS["nonexistent"]).toBeUndefined();
  });
});
