// 2026-06-15 · Sam directive: "Remove all commission grids. Remove that
// shit completely from everyone's view, including me."
// Tombstone redirect to /dashboard preserves anyone bookmarked + clears the
// page from the sidebar + route + nav.

import { Navigate } from "react-router-dom";

export default function CommissionGrids() {
  return <Navigate to="/dashboard" replace />;
}
