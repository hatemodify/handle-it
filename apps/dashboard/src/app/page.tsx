import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireSessionUser();
  redirect("/jobs");
}
