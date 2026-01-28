import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, DollarSign, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Deal {
  id: string;
  premium: number;
}

interface BubbleDealEntryProps {
  onALPChange: (alp: number) => void;
  onDealsChange: (deals: number) => void;
  initialDeals?: { id: string; amount: string; frequency: "monthly" | "annual" }[];
}

export function BubbleDealEntry({ onALPChange, onDealsChange, initialDeals }: BubbleDealEntryProps) {
  // Convert legacy format to new simple format (ALP stored directly)
  const convertedInitialDeals: Deal[] = initialDeals?.map(d => ({
    id: d.id,
    premium: parseFloat(d.amount) || 0
  })).filter(d => d.premium > 0) || [];

  const [deals, setDeals] = useState<Deal[]>(convertedInitialDeals);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Calculate totals - direct sum, no conversion needed
  const totalALP = deals.reduce((sum, deal) => sum + deal.premium, 0);
  const dealCount = deals.length;

  // Notify parent of changes
  useEffect(() => {
    onALPChange(totalALP);
    onDealsChange(dealCount);
  }, [totalALP, dealCount, onALPChange, onDealsChange]);

  // Add a new deal
  const addDeal = useCallback(() => {
    const premium = parseFloat(inputValue);
    if (!premium || premium <= 0) return;

    const newDeal: Deal = {
      id: crypto.randomUUID(),
      premium
    };

    setDeals(prev => [...prev, newDeal]);
    setInputValue("");
    
    // Refocus input for quick entry of multiple deals
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputValue]);

  // Remove a deal
  const removeDeal = (id: string) => {
    setDeals(prev => prev.filter(d => d.id !== id));
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDeal();
    }
  };

  const hasValidInput = parseFloat(inputValue) > 0;

  return (
    <div className="space-y-4">
      {/* Deal Bubbles */}
      {deals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {deals.map((deal, index) => (
              <motion.div
                key={deal.id}
                layout
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ 
                  type: "spring", 
                  stiffness: 500, 
                  damping: 25,
                  delay: index * 0.02
                }}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2.5 rounded-full",
                  "bg-gradient-to-r from-primary/15 to-accent/15",
                  "border-2 border-primary/30 shadow-lg shadow-primary/10",
                  "backdrop-blur-sm"
                )}
              >
                <span className="text-xs font-bold text-primary">#{index + 1}</span>
                <span className="text-sm font-bold text-foreground">
                  ${deal.premium.toLocaleString()}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  ALP
                </span>
                <button
                  type="button"
                  onClick={() => removeDeal(deal.id)}
                  className="ml-1 h-5 w-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Input + Add Button Row */}
      <div className="flex gap-3">
        {/* Premium Input */}
        <div className="relative flex-1">
          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="Enter ALP"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-11 h-14 text-lg font-semibold border-2 border-border focus:border-primary bg-background/80"
          />
        </div>

        {/* Add Deal Button */}
        <Button
          type="button"
          onClick={addDeal}
          disabled={!hasValidInput}
          className={cn(
            "h-14 px-6 text-base font-bold shrink-0",
            "bg-primary hover:bg-primary/90",
            "shadow-lg transition-all duration-200",
            hasValidInput && "shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02]",
            !hasValidInput && "opacity-50"
          )}
        >
          <Plus className="h-5 w-5 mr-1" />
          Add Deal
        </Button>
      </div>

      {/* Summary */}
      {totalALP > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 border border-primary/20"
        >
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-sm">✓</span>
            </div>
            <span className="text-base font-semibold">
              {dealCount} {dealCount === 1 ? "Deal" : "Deals"}
            </span>
          </div>
          <div className="text-right">
            <motion.p 
              key={totalALP}
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              className="text-2xl font-bold text-primary"
            >
              ${totalALP.toLocaleString()}
            </motion.p>
            <span className="text-xs text-muted-foreground">Total ALP</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
