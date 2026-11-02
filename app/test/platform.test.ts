import { describe, expect, it } from "vitest";
import { detectPlatform } from "../src/lib/platform";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("plataforma", () => {
  it("la app de Android se reconoce por el referrer, y se recuerda", () => {
    expect(detectPlatform(ANDROID_UA, "android-app://es.frantejeda.salary/", false)).toBe("android-app");
    expect(detectPlatform(ANDROID_UA, "", true)).toBe("android-app");
  });
  it("Android en el navegador y el resto", () => {
    expect(detectPlatform(ANDROID_UA, "https://google.com", false)).toBe("android-web");
    expect(detectPlatform(IPHONE_UA, "", false)).toBe("other");
  });
});
