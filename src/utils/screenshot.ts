import fs from "node:fs/promises";
import sharp from "sharp";

/** Max dimension (longest side) for screenshots sent to the API. */
const MAX_DIMENSION = 1280;

/**
 * Read screenshot, convert to sRGB JPEG, resize if needed, return base64.
 * Fixes Display P3 color profile issue that causes Anthropic API 400 errors.
 */
export async function readScreenshotSafe(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size < 500) throw new Error(`Screenshot corrupt or truncated (${stat.size}B): ${filePath}`);
  if (stat.size > 20 * 1024 * 1024) throw new Error(`Screenshot too large (${stat.size} bytes): ${filePath}`);

  const buffer = await sharp(filePath)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColorspace("srgb")
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  // Validate JPEG magic bytes
  if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error(`Sharp produced invalid output (no JPEG magic bytes) for: ${filePath}`);
  }

  return buffer.toString("base64");
}
