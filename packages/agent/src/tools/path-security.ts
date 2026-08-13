import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const inside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export const resolveRepositoryPath = async (root: string, requested = ".", mustExist = true): Promise<string> => {
  const realRoot = await realpath(root);
  const candidate = resolve(realRoot, requested);
  if (!inside(realRoot, candidate)) throw new Error("PATH_OUTSIDE_REPOSITORY");
  if (!mustExist) return candidate;
  const actual = await realpath(candidate);
  if (!inside(realRoot, actual)) throw new Error("PATH_OUTSIDE_REPOSITORY");
  return actual;
};
