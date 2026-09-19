export const STORAGE_KEY = "mino-open-path";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function parseOpenPath(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function readOpenPath(storage: StorageLike | null | undefined): string {
  try {
    return parseOpenPath(storage?.getItem(STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writeOpenPath(
  storage: StorageLike | null | undefined,
  path: unknown,
): string {
  const value = parseOpenPath(path);
  try {
    if (!storage) return value;
    if (!value) {
      storage.removeItem(STORAGE_KEY);
      return "";
    }
    storage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
  return value;
}

export function clearOpenPath(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function resolveOpenPath(
  stored: unknown,
  fileIndex: { includes(path: string): boolean } | null | undefined,
): string {
  const path = parseOpenPath(stored);
  if (!path) return "";
  if (!fileIndex || typeof fileIndex.includes !== "function") return "";
  return fileIndex.includes(path) ? path : "";
}

export function createOpenPathRestore() {
  let done = false;
  return function takeOpenPathRestore(
    storage: StorageLike | null | undefined,
    fileIndex: { includes(path: string): boolean } | null | undefined,
  ): string {
    if (done) return "";
    done = true;
    const path = resolveOpenPath(readOpenPath(storage), fileIndex);
    if (!path) clearOpenPath(storage);
    return path;
  };
}
