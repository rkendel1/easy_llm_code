export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

const users = new Map<string, User>();

export const saveUser = (user: User): User => {
  users.set(user.id, user);
  return user;
};

export const findUserByEmail = (email: string): User | undefined => {
  for (const user of users.values()) {
    if (user.email === email) {
      return user;
    }
  }
  return undefined;
};
