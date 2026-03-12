import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { X, Search, Pill, AlertCircle } from "lucide-react";
import type { SelectedMedication, QEMedication } from "@/lib/quoteEngineTypes";

interface MedicationSearchProps {
  selected: SelectedMedication[];
  onChange: (medications: SelectedMedication[]) => void;
}

export function MedicationSearch({ selected, onChange }: MedicationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QEMedication[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("qe_medications")
        .select("*")
        .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,brand_names.cs.{${query.toLowerCase()}}`)
        .limit(15);
      setResults((data as QEMedication[] | null) ?? []);
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

  const addMedication = (med: QEMedication) => {
    if (selected.some(s => s.id === med.id)) return;
    onChange([...selected, { id: med.id, name: med.name, category: med.category }]);
    setQuery("");
    setShowDropdown(false);
  };

  const removeMedication = (id: string) => {
    onChange(selected.filter(s => s.id !== id));
  };

  return (
    <div ref={ref} className="space-y-2">
      <label className="text-sm font-medium text-foreground">Medications</label>
      <div className="relative">
        <Pill className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search medications (brand or generic)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowDropdown(true)}
          className="pl-9"
        />
        {showDropdown && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {results.map((med) => (
              <button
                key={med.id}
                onClick={() => addMedication(med)}
                className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm font-medium">{med.name}</span>
                {med.generic_name && (
                  <span className="text-xs text-muted-foreground ml-2">({med.generic_name})</span>
                )}
                <Badge variant="outline" className="text-xs ml-2">{med.category}</Badge>
              </button>
            ))}
          </div>
        )}
        {showDropdown && results.length === 0 && query.length >= 2 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-3">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> No matching medications found
            </p>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((med) => (
            <Tooltip key={med.id}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 bg-orange-500/10 border border-orange-500/20 rounded-lg px-2 py-1">
                  <Pill className="h-3 w-3 text-orange-600" />
                  <span className="text-xs font-medium text-orange-700 dark:text-orange-400">{med.name}</span>
                  <button onClick={() => removeMedication(med.id)} className="ml-1 text-orange-500/60 hover:text-orange-600">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Category: {med.category}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
