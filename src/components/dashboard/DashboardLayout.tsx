import { ReactNode } from "react";
import { SidebarLayout } from "@/components/layout/SidebarLayout";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarLayout showPhoneBanner={true}>
      {children}
    </SidebarLayout>
  );
}
