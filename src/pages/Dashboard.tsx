import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  Users,
  TrendingUp,
  Award,
  Target,
  FileCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { MetricsCard } from "@/components/dashboard/MetricsCard";
import { VSLSection } from "@/components/dashboard/VSLSection";
import { GlassCard } from "@/components/ui/glass-card";

interface AgentMetrics {
  earnings: number;
  leadsGenerated: number;
  policiesSold: number;
  closeRate: number;
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<AgentMetrics>({
    earnings: 0,
    leadsGenerated: 0,
    policiesSold: 0,
    closeRate: 0,
  });
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || "Agent");
        
        // Fetch agent metrics if available
        const { data: agentData } = await supabase
          .from("agents")
          .select("total_earnings, total_policies, total_premium")
          .eq("user_id", user.id)
          .single();
        
        if (agentData) {
          setMetrics({
            earnings: agentData.total_earnings || 0,
            leadsGenerated: 45, // Demo data
            policiesSold: agentData.total_policies || 0,
            closeRate: 32, // Demo data
          });
        }
      }
    };
    
    fetchData();
  }, []);

  const recentActivity = [
    { id: 1, type: "lead", message: "New lead assigned: John D.", time: "2 hours ago" },
    { id: 2, type: "policy", message: "Policy #A2847 approved", time: "5 hours ago" },
    { id: 3, type: "training", message: "Completed: Objection Handling", time: "1 day ago" },
    { id: 4, type: "achievement", message: "Earned: First Sale Badge", time: "2 days ago" },
  ];

  return (
    <DashboardLayout>
      {/* VSL Section */}
      <VSLSection />

      {/* Welcome Message */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-8"
      >
        <h2 className="text-2xl font-bold">Welcome back, {userName}! 👋</h2>
        <p className="text-muted-foreground">Here's your performance overview</p>
      </motion.div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <MetricsCard
          title="Total Earnings"
          value={`$${metrics.earnings.toLocaleString()}`}
          icon={DollarSign}
          trend={{ value: 12, isPositive: true }}
        />
        <MetricsCard
          title="Leads Generated"
          value={metrics.leadsGenerated}
          icon={Users}
          trend={{ value: 8, isPositive: true }}
        />
        <MetricsCard
          title="Policies Sold"
          value={metrics.policiesSold}
          icon={FileCheck}
          trend={{ value: 15, isPositive: true }}
        />
        <MetricsCard
          title="Close Rate"
          value={`${metrics.closeRate}%`}
          icon={Target}
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                >
                  <div className="p-2 rounded-full bg-primary/10">
                    {activity.type === "lead" && <Users className="h-4 w-4 text-primary" />}
                    {activity.type === "policy" && <FileCheck className="h-4 w-4 text-primary" />}
                    {activity.type === "training" && <TrendingUp className="h-4 w-4 text-primary" />}
                    {activity.type === "achievement" && <Award className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{activity.message}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold mb-4">This Month's Goals</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Lead Conversion</span>
                  <span className="text-sm text-muted-foreground">8/15</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: "53%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Revenue Target</span>
                  <span className="text-sm text-muted-foreground">$12K / $20K</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: "60%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Training Progress</span>
                  <span className="text-sm text-muted-foreground">7/10 modules</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: "70%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Appointments Set</span>
                  <span className="text-sm text-muted-foreground">12/25</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: "48%" }} />
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
