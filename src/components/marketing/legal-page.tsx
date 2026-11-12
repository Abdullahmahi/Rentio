import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";

/**
 * Chrome for /privacy, /terms and /contact. The body copy of those pages is
 * English only for now (audit.md §8 gate 5); the navbar and footer still
 * follow the EN/ES toggle.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
        <h1 className="font-heading text-3xl font-medium md:text-4xl">{title}</h1>
        {updated ? <p className="mt-2 text-sm text-muted-foreground">{updated}</p> : null}
        <div className="mt-8 space-y-6 text-base leading-relaxed text-muted-foreground [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}

/** How to reach us, leaving out an empty email. */
export function ContactSentence({ entity, email }: { entity: string; email: string }) {
  return (
    <>
      {entity}
      {email ? (
        <>
          {" "}
          at <a href={`mailto:${email}`}>{email}</a>
        </>
      ) : (
        <>
          {" "}
          through our <Link to="/contact">contact page</Link>
        </>
      )}
    </>
  );
}
