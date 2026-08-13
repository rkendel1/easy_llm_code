import { findUserByEmail, saveUser, type User } from "./repository";

const hashPassword = (password: string): string => `hashed:${password}`;

export const createUser = (email: string, password: string): User => {
  const existing = findUserByEmail(email);
  if (existing) {
    throw new Error("User already exists");
  }

  const user: User = {
    id: `user-${email}`,
    email,
    passwordHash: hashPassword(password)
  };

  return saveUser(user);
};
