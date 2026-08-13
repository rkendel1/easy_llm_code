import type { VerificationResult } from "./types.js";

export const classifyVerificationFailure = (result: VerificationResult): string => {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (result.status === "timed_out") return "timeout";
  if (result.status === "denied") return "untrusted_command";
  if (/type(error|script)|ts\d{4}/.test(output)) return "type_error";
  if (/assert|expected|test.*fail|fail.*test/.test(output)) return "test_failure";
  if (/lint|eslint|prettier/.test(output)) return "lint_failure";
  return "command_failure";
};
