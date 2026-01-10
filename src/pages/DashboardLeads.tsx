import { useState } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Phone,
  Mail,
  MapPin,
  Clock,
  Filter,
  Search,
  ChevronRight,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  status: "new" | "contacted" | "qualified" | "proposal" | "closed";
  assignedAt: string;
  notes?: string;
}

const demoLeads: Lead[] = [
  {
    id: "1",
    name: "Sarah Johnson",
    email: "sarah.j@email.com",
    phone: "(555) 123-4567",
    location: "Atlanta, GA",
    status: "new",
    assignedAt: "2 hours ago",
  },
  {
    id: "2",
    name: "Michael Chen",
    email: "m.chen@email.com",
    phone: "(555) 234-5678",
    location: "Miami, FL",
    status: "contacted",
    assignedAt: "1 day ago",
  },
  {
    id: "3",
    name: "Emily Rodriguez",
    email: "emily.r@email.com",
    phone: "(555) 345-6789",
    location: "Houston, TX",
    status: "qualified",
    assignedAt: "2 days ago",
  },
  {
    id: "4",
    name: "David Kim",
    email: "d.kim@email.com",
    phone: "(555) 456-7890",
    location: "Phoenix, AZ",
    status: "proposal",
    assignedAt: "3 days ago",
  },
  {
    id: "5",
    name: "Jessica Brown",
    email: "j.brown@email.com",
    phone: "(555) 567-8901",
    location: "Denver, CO",
    status: "closed",
    assignedAt: "1 week ago",
  },
];

const statusColors = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  contacted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  qualified: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  proposal: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  closed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

export default function DashboardLeads() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredLeads = demoLeads.filter((lead) => {
    const matchesSearch = lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <DashboardLayout>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold mb-2">Leads Management</h1>
        <p className="text-muted-foreground">
          Track and manage your assigned leads
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8"
      >
        {[
          { label: "Total Leads", value: 45, color: "text-foreground" },
          { label: "New", value: 12, color: "text-blue-400" },
          { label: "Contacted", value: 15, color: "text-yellow-400" },
          { label: "Qualified", value: 10, color: "text-purple-400" },
          { label: "Closed", value: 8, color: "text-emerald-400" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="p-4 text-center">
            <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </GlassCard>
        ))}
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex flex-col sm:flex-row gap-4 mb-6"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48 bg-input">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="proposal">Proposal</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* Leads List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-4"
      >
        {filteredLeads.map((lead, index) => (
          <motion.div
            key={lead.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 * index }}
          >
            <GlassCard className="p-4 hover:bg-muted/50 transition-colors cursor-pointer">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                {/* Avatar & Name */}
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{lead.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Assigned {lead.assignedAt}</span>
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{lead.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span>{lead.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{lead.location}</span>
                  </div>
                </div>

                {/* Status & Action */}
                <div className="flex items-center gap-4">
                  <Badge
                    variant="outline"
                    className={cn("capitalize", statusColors[lead.status])}
                  >
                    {lead.status}
                  </Badge>
                  <Button variant="ghost" size="icon">
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}

        {filteredLeads.length === 0 && (
          <GlassCard className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No leads found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search or filter criteria
            </p>
          </GlassCard>
        )}
      </motion.div>
    </DashboardLayout>
  );
}
