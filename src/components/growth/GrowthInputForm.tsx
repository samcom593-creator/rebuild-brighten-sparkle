import { Loader2, Save, BarChart3 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface GrowthInputFormProps {
  todayPST: string;
  formApps: string;
  setFormApps: (v: string) => void;
  formViews: string;
  setFormViews: (v: string) => void;
  formFollowers: string;
  setFormFollowers: (v: string) => void;
  formFollowerCount: string;
  setFormFollowerCount: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  isAllowed: boolean;
}

export function GrowthInputForm({
  todayPST, formApps, setFormApps, formViews, setFormViews,
  formFollowers, setFormFollowers, formFollowerCount, setFormFollowerCount,
  saving, onSave, isAllowed,
}: GrowthInputFormProps) {
  if (!isAllowed) {
    return (
      <GlassCard className="p-6 text-center">
        <p className="text-muted-foreground">Only managers can log growth numbers.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        Log Today's Growth Numbers
        <Badge variant="outline" className="ml-auto text-xs">{todayPST}</Badge>
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Applications Submitted</Label>
          <Input type="number" min="0" value={formApps} onChange={e => setFormApps(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">IG Story Views (this week)</Label>
          <Input type="number" min="0" value={formViews} onChange={e => setFormViews(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">New Followers Gained</Label>
          <Input type="number" min="0" value={formFollowers} onChange={e => setFormFollowers(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Total Follower Count</Label>
          <Input type="number" min="0" value={formFollowerCount} onChange={e => setFormFollowerCount(e.target.value)} placeholder="0" className="bg-input text-center text-lg font-bold" />
        </div>
      </div>
      <Button onClick={onSave} disabled={saving} className="w-full mt-4">
        {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="h-4 w-4 mr-2" /> Save Numbers</>}
      </Button>
    </GlassCard>
  );
}
