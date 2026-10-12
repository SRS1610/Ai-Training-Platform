import { redirect } from "next/navigation";

/** MFA is a step inside /login (it needs the short-lived challenge token held in memory). */
export default function MfaPage() {
  redirect("/login");
}
