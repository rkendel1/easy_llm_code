import { authenticate, register } from "../src/auth";

export const authTest = () => {
  register("b@example.com", "pw");
  if (!authenticate("session-b@example.com")) {
    throw new Error("expected authentication success");
  }
};
