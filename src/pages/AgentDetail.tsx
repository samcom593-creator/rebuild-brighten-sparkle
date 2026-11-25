import { Navigate, useLocation, useParams } from "react-router-dom";

/** Keep existing profile links working through the one canonical, scoped producer view. */
export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (id) params.set("agentId", id);
  return <Navigate replace to={id ? `/dashboard/profile?${params.toString()}${location.hash}` : "/dashboard/team"} />;
}
