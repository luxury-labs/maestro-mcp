import fs from "node:fs/promises";

/** Read screenshot file and return base64 */
export async function screenshotToBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

/** Get screenshot size in bytes */
export async function screenshotSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}
