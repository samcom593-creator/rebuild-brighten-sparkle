import { Button } from "@/components/ui/button";
import { Users, TrendingUp, AlertTriangle, XCircle, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

type FilterType = "all" | "producers" | "weak" | "zero" | "course_purchased";

interface QuickFiltersProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
}

export function QuickFilters({ activeFilter, onFilterChange }: QuickFiltersProps) {
  const filters: { id: FilterType; label: string; icon: React.ReactNode; color?: string }[] = [
    { id: "all", label: "All Agents", icon: <Users className="h-4 w-4" /> },
    { id: "producers", label: "Producers", icon: <TrendingUp className="h-4 w-4" />, color: "text-green-500" },
    { id: "weak", label: "Needs Attention", icon: <AlertTriangle className="h-4 w-4" />, color: "text-amber-500" },
    { id: "zero", label: "Zero Production", icon: <XCircle className="h-4 w-4" />, color: "text-red-500" },
    { id: "course_purchased", label: "Course Purchased", icon: <GraduationCap className="h-4 w-4" />, color: "text-purple-500" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => (
        <Button
          key={filter.id}
          variant={activeFilter === filter.id ? "default" : "outline"}
          size="sm"
          onClick={() => onFilterChange(filter.id)}
          className={cn(
            "gap-2",
            activeFilter !== filter.id && filter.color
          )}
        >
          {filter.icon}
          {filter.label}
        </Button>
      ))}
    </div>
  );
}
