import { Button, EmptyState } from "@praxis/ui";
import Link from "next/link";
import { Logo } from "@/components/common/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-aurora">
      <header className="container flex h-16 items-center">
        <Logo />
      </header>
      <main id="main" className="container grid flex-1 place-items-center pb-20">
        <EmptyState
          size="lg"
          illustration="search"
          title="We couldn't find that page"
          description="It may have moved, or the link might be incomplete."
          action={
            <Button asChild variant="gradient">
              <Link href="/">Go home</Link>
            </Button>
          }
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href="/app/dashboard">Open dashboard</Link>
            </Button>
          }
        />
      </main>
    </div>
  );
}
