import { createUser } from "../src/users";

export const usersTest = () => {
  const user = createUser("a@example.com", "pw");
  if (!user.id.includes("a@example.com")) {
    throw new Error("unexpected user id");
  }
};
