import fs from "node:fs/promises";
import path from "node:path";

const BASE_DIR = path.join(process.cwd(), ".maestro-mcp");

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.join(BASE_DIR, "flows"), { recursive: true });
  await fs.mkdir(path.join(BASE_DIR, "screenshots"), { recursive: true });
  await fs.mkdir(path.join(BASE_DIR, "tmp"), { recursive: true });
}

export async function cleanDir(subdir: string): Promise<number> {
  const dir = path.join(BASE_DIR, subdir);
  try {
    const files = await fs.readdir(dir);
    let count = 0;
    for (const file of files) {
      await fs.unlink(path.join(dir, file));
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

export function getPath(subdir: string, filename: string): string {
  return path.join(BASE_DIR, subdir, filename);
}
