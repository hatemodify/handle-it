import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { env } from "./env";
import { getSessionUser, getSessionUserFromRequest } from "./session";

export const requireSessionUser = async () => {
  const user = await getSessionUser();
  if (!user) {
    if (env.localDevAuthBypass) {
      throw new Error("local dev auth bypass enabled but no user resolved");
    }
    redirect("/login");
  }
  return user;
};

export const requireSessionUserFromRequest = async (req: NextRequest) => {
  const user = await getSessionUserFromRequest(req);
  return user;
};
