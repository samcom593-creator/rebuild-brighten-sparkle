import { useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Filter,
  Loader2,
  FileSpreadsheet,
  Calendar,
  CheckCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

interface LeadExporterProps {
  className?: string;
}

const STATUS_OPTIONS = [
  { value: "new" as const, label: "New" },
  { value: "reviewing" as const, label: "Reviewing" },
  { value: "interview" as const, label: "Interview" },
  { value: "contracting" as const, label: "Contracting" },
  { value: "approved" as const, label: "Approved" },
  { value: "rejected" as const, label: "Rejected" },
];

const LICENSE_OPTIONS = [
  { value: "licensed" as const, label: "Licensed" },
  { value: "unlicensed" as const, label: "Unlicensed" },
  { value: "pending" as const, label: "Pending" },
];

type ApplicationStatus = "new" | "reviewing" | "interview" | "contracting" | "approved" | "rejected";
type LicenseStatus = "licensed" | "unlicensed" | "pending";

export function LeadExporter({ className }: LeadExporterProps) {
  const { user, isAdmin, isManager } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<ApplicationStatus[]>([]);
  const [selectedLicenses, setSelectedLicenses] = useState<LicenseStatus[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exportCount, setExportCount] = useState<number | null>(null);

  const toggleStatus = (status: ApplicationStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  const toggleLicense = (license: LicenseStatus) => {
    setSelectedLicenses((prev) =>
      prev.includes(license)
        ? prev.filter((l) => l !== license)
        : [...prev, license]
    );
  };

  const handleExport = async () => {
    if (!user) return;
    setLoading(true);

    try {
      let query = supabase
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false });

      // Apply status filter
      if (selectedStatuses.length > 0) {
        query = query.in("status", selectedStatuses);
      }

      // Apply license filter
      if (selectedLicenses.length > 0) {
        query = query.in("license_status", selectedLicenses);
      }

      // Apply date filters
      if (startDate) {
        query = query.gte("created_at", startDate);
      }
      if (endDate) {
        query = query.lte("created_at", `${endDate}T23:59:59`);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (!data || data.length === 0) {
        toast({
          title: "No Data",
          description: "No leads match your filter criteria.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Generate CSV
      const headers = [
        "First Name",
        "Last Name",
        "Email",
        "Phone",
        "Instagram",
        "City",
        "State",
        "License Status",
        "Status",
        "NIPR Number",
        "Experience",
        "Previous Company",
        "Desired Income",
        "Availability",
        "Referral Source",
        "Created Date",
      ];

      const rows = data.map((lead) => [
        lead.first_name || "",
        lead.last_name || "",
        lead.email || "",
        lead.phone || "",
        lead.instagram_handle ? `@${lead.instagram_handle}` : "",
        lead.city || "",
        lead.state || "",
        lead.license_status || "",
        lead.status || "",
        lead.nipr_number || "",
        lead.has_insurance_experience
          ? `${lead.years_experience || 0} years`
          : "None",
        lead.previous_company || "",
        lead.desired_income ? `$${lead.desired_income.toLocaleString()}` : "",
        lead.availability || "",
        lead.referral_source || "",
        new Date(lead.created_at).toLocaleDateString(),
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      // Download file
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `apex-leads-${new Date().toISOString().split("T")[0]}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportCount(data.length);
      toast({
        title: "Export Complete",
        description: `Successfully exported ${data.length} leads to CSV.`,
      });
    } catch (err) {
      console.error("Export error:", err);
      toast({
        title: "Export Failed",
        description: "Failed to export leads. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = () => {
    setSelectedStatuses([]);
    setSelectedLicenses([]);
    setStartDate("");
    setEndDate("");
    setExportCount(null);
  };

  if (!isAdmin && !isManager) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <Download className="h-4 w-4 mr-2" />
          Export Leads
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Export Leads to CSV
          </DialogTitle>
          <DialogDescription>
            Download leads for SMS or email campaigns. Apply filters to narrow
            your export.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status Filter */}
          <div>
            <Label className="text-sm font-medium flex items-center gap-2 mb-3">
              <Filter className="h-4 w-4" />
              Filter by Status
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((status) => (
                <div key={status.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`status-${status.value}`}
                    checked={selectedStatuses.includes(status.value)}
                    onCheckedChange={() => toggleStatus(status.value)}
                  />
                  <Label
                    htmlFor={`status-${status.value}`}
                    className="text-sm cursor-pointer"
                  >
                    {status.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* License Filter */}
          <div>
            <Label className="text-sm font-medium mb-3 block">
              Filter by License Status
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {LICENSE_OPTIONS.map((license) => (
                <div key={license.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`license-${license.value}`}
                    checked={selectedLicenses.includes(license.value)}
                    onCheckedChange={() => toggleLicense(license.value)}
                  />
                  <Label
                    htmlFor={`license-${license.value}`}
                    className="text-sm cursor-pointer"
                  >
                    {license.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div>
            <Label className="text-sm font-medium flex items-center gap-2 mb-3">
              <Calendar className="h-4 w-4" />
              Date Range
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="start-date" className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="end-date" className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Export Result */}
          {exportCount !== null && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-emerald-500 bg-emerald-500/10 rounded-lg p-3"
            >
              <CheckCircle className="h-5 w-5" />
              <span className="text-sm">
                Exported {exportCount} leads successfully!
              </span>
            </motion.div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="ghost" onClick={resetFilters}>
            Reset Filters
          </Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {loading ? "Exporting..." : "Export CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
