import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { X, Search, AlertCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SelectedCondition, QECondition } from "@/lib/quoteEngineTypes";

interface ConditionSearchProps {
  selected: SelectedCondition[];
  onChange: (conditions: SelectedCondition[]) => void;
}

export function ConditionSearch({ selected, onChange }: ConditionSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QECondition[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("qe_conditions")
        .select("*")
        .or(`name.ilike.%${query}%,synonyms.cs.{${query.toLowerCase()}}`)
        .limit(15);
      setResults((data as QECondition[] | null) ?? []);
      setShowDropdown(true);
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addCondition = (cond: QECondition) => {
    if (selected.some(s => s.id === cond.id)) return;
    onChange([...selected, { id: cond.id, name: cond.name, category: cond.category }]);
    setQuery("");
    setShowDropdown(false);
  };

  const removeCondition = (id: string) => {
    onChange(selected.filter(s => s.id !== id));
  };

  const updateSeverity = (id: string, severity: string) => {
    onChange(selected.map(s => s.id === id ? { ...s, severity } : s));
  };

  const updateRecency = (id: string, months: number) => {
    onChange(selected.map(s => s.id === id ? { ...s, recencyMonths: months } : s));
  };

  return (
    <div ref={ref} className="space-y-2">
      <label className="text-sm font-medium text-foreground">Health Conditions</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search conditions (e.g., diabetes, COPD, CHF)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowDropdown(true)}
          className="pl-9"
        />
        {showDropdown && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {results.map((cond) => (
              <button
                key={cond.id}
                onClick={() => addCondition(cond)}
                className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex justify-between items-center"
              >
                <span className="text-sm font-medium">{cond.name}</span>
                <Badge variant="outline" className="text-xs">{cond.category}</Badge>
              </button>
            ))}
          </div>
        )}
        {showDropdown && results.length === 0 && query.length >= 2 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-3">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> No matching conditions found
            </p>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((cond) => (
            <Tooltip key={cond.id}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg px-2 py-1">
                  <span className="text-xs font-medium text-destructive">{cond.name}</span>
                  {cond.severity && (
                    <Badge variant="outline" className="text-[10px] h-4">{cond.severity}</Badge>
                  )}
                  <button onClick={() => removeCondition(cond.id)} className="ml-1 text-destructive/60 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs space-y-2 p-3">
                <p className="font-medium text-sm">{cond.name}</p>
                <div className="flex gap-2">
                  <Select value={cond.severity || ""} onValueChange={(v) => updateSeverity(cond.id, v)}>
                    <SelectTrigger className="h-7 text-xs w-28">
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mild">Mild</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="severe">Severe</SelectItem>
                      <SelectItem value="controlled">Controlled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="Months ago"
                    value={cond.recencyMonths ?? ""}
                    onChange={(e) => updateRecency(cond.id, parseInt(e.target.value) || 0)}
                    className="h-7 text-xs w-24"
                  />
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
