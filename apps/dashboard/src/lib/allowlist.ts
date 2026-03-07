import { env } from "./env";

export const isAllowedEmail = (email: string): boolean => {
  if (env.localDevAuthBypass) {
    return true;
  }
  return email.toLowerCase() === env.allowedEmail;
};
