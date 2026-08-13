export class SandboxError extends Error { constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); } }
export const sandboxInvariant: (condition: unknown, code: string, message: string) => asserts condition = (condition, code, message) => { if (!condition) throw new SandboxError(code, message); };
