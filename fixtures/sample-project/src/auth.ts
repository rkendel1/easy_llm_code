import { createUser } from "./users";

export const register = (email: string, password: string) => {
  return createUser(email, password);
};

export const authenticate = (token: string): boolean => {
  return token.startsWith("session-");
};
