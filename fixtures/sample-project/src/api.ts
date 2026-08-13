import { register } from "./auth";

export const registerRoute = (payload: { email: string; password: string }) => {
  return register(payload.email, payload.password);
};
