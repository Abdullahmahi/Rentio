import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Password reset lives inside Clerk's sign-in now. Kept as a redirect so
 * bookmarks and old emails do not dead-end.
 */
export const Route = createFileRoute("/reset-password")({
  component: () => <Navigate to="/sign-in" replace />,
});
