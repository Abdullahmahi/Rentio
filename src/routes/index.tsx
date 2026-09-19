import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { homeFor, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({ component: IndexRedirect });

/** The landing route owns no UI — it just forwards each role to its shell.
 *  Redirecting in beforeLoad is not an option: the session only exists
 *  client-side. */
function IndexRedirect() {
  const { loading, user, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    void navigate({ to: user && role ? homeFor(role) : "/login", replace: true });
  }, [loading, user, role, navigate]);

  return <div className="min-h-screen bg-background" />;
}
