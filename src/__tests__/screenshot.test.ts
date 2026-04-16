import { describe, it, expect } from "vitest";
import { readScreenshotSafe } from "../utils/screenshot.js";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const TMP = path.join(os.tmpdir(), "maestro-mcp-tests");

async function createTestPng(width = 200, height = 200): Promise<string> {
  await fs.mkdir(TMP, { recursive: true });
  const filePath = path.join(TMP, `test-${Date.now()}.png`);
  await sharp({
    create: { width, height, channels: 4, background: { r: 128, g: 64, b: 200, alpha: 1 } },
  })
    .png()
    .toFile(filePath);
  return filePath;
}

describe("readScreenshotSafe", () => {
  it("converts valid PNG to base64 JPEG", async () => {
    const png = await createTestPng();
    const base64 = await readScreenshotSafe(png);
    expect(base64.length).toBeGreaterThan(0);

    // Decode and verify JPEG
    const buf = Buffer.from(base64, "base64");
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);

    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.space).toBe("srgb");
    expect(meta.hasAlpha).toBe(false);
  });

  it("resizes large images to max 1280", async () => {
    const png = await createTestPng(3000, 2000);
    const base64 = await readScreenshotSafe(png);
    const buf = Buffer.from(base64, "base64");
    const meta = await sharp(buf).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1280);
  });

  it("throws on tiny file (<500 bytes)", async () => {
    await fs.mkdir(TMP, { recursive: true });
    const tiny = path.join(TMP, "tiny.png");
    await fs.writeFile(tiny, Buffer.alloc(100));
    await expect(readScreenshotSafe(tiny)).rejects.toThrow("corrupt");
  });

  it("throws on oversized file (>20MB)", async () => {
    await fs.mkdir(TMP, { recursive: true });
    const big = path.join(TMP, "big.png");
    await fs.writeFile(big, Buffer.alloc(21 * 1024 * 1024));
    await expect(readScreenshotSafe(big)).rejects.toThrow("too large");
  });
});
