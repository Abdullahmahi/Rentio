import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * The old sign-in path, kept as a redirect.
 *
 * Invite emails already delivered, browser bookmarks and the odd typed URL
 * all still point here. Renaming the route without this would break them
 * silently, and a dead link on the front door is the worst one to break.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  component: LoginRedirect,
});

function LoginRedirect() {
  const search = Route.useSearch();
  return <Navigate to="/sign-in" search={search} replace />;
}
