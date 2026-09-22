import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { homeFor, useAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

function SessionSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="min-h-screen bg-background p-6"
      role="status"
      aria-label={t("auth.checkingSession")}
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-80" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
      <span className="sr-only">{t("auth.checkingSession")}</span>
    </div>
  );
}

/**
 * Gate for a whole shell. While the session resolves it renders a skeleton —
 * never the login page, which would flash for an already-authenticated user.
 * A signed-in user on the wrong shell is sent to their own home, never to a
 * blank page.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: "staff" | "tenant";
  children: ReactNode;
}) {
  const { loading, user, role, isStaff } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const permitted = allow === "staff" ? isStaff : role === "tenant";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/sign-in", search: { redirect: pathname }, replace: true });
      return;
    }
    // Signed in but the profile row is missing or still loading a role.
    if (!role) return;
    if (!permitted) void navigate({ to: homeFor(role), replace: true });
  }, [loading, user, role, permitted, navigate, pathname]);

  if (loading || !user || !role || !permitted) return <SessionSkeleton />;
  return <>{children}</>;
}
