/**
 * page.tsx: site landing page; redirects straight to the tasks page /function/tasks.
 * Main functions/types:
 *   - Home: redirect entry that performs the redirect
 */
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/function/tasks");
  return <>Coming Soon</>;
}
