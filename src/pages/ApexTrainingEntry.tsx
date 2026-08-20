import { Navigate } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import ApexCareerToolkit from "@/pages/ApexCareerToolkit";

/** Staff land on lifecycle operations; agents land on the learning library. */
export default function ApexTrainingEntry() {
  const { isLoading, isAdmin, isManager, isVaManager, isVa } = useAuth();

  if (isLoading) return <SkeletonLoader variant="page" />;
  if (isAdmin || isManager || isVaManager || isVa) return <ApexCareerToolkit />;

  return <Navigate to="/dashboard/recruiting/training/library" replace />;
}
