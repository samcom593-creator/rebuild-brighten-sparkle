import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, DollarSign, Check, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Deal {
  id: string;
  amount: string;
  frequency: "monthly" | "annual";
}

interface ALPCalculatorProps {
  onALPChange: (alp: number) => void;
  onDealsChange: (deals: number) => void;
  initialALP?: number;
  initialDeals?: number;
}

export function ALPCalculator({ onALPChange, onDealsChange, initialALP = 0, initialDeals = 0 }: ALPCalculatorProps) {
  // Always keep at least one deal row (the "active draft")
  const [deals, setDeals] = useState<Deal[]>([
    { id: crypto.randomUUID(), amount: "", frequency: "monthly" }
  ]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Calculate ALP for a single deal
  const getDealALP = useCallback((deal: Deal) => {
    const amount = parseFloat(deal.amount) || 0;
    if (amount <= 0) return 0;
    return deal.frequency === "monthly" ? amount * 12 : amount;
  }, []);

  // Calculate total ALP from ALL deals (including current draft if valid)
  const calculateTotalALP = useCallback((dealList: Deal[]) => {
    return dealList.reduce((total, deal) => total + getDealALP(deal), 0);
  }, [getDealALP]);

  // Count deals with valid amounts (including current draft)
  const countDeals = useCallback((dealList: Deal[]) => {
    return dealList.filter(d => parseFloat(d.amount) > 0).length;
  }, []);

  // The active (current typing) deal is always the LAST one
  const activeDeal = deals[deals.length - 1];

  // Committed deals = all except the last one, filtered to only those with valid amounts
  const committedDeals = deals.slice(0, -1).filter(d => parseFloat(d.amount) > 0);

  // Notify parent of totals (includes active draft if valid)
  useEffect(() => {
    const totalALP = calculateTotalALP(deals);
    const dealCount = countDeals(deals);
    onALPChange(totalALP);
    onDealsChange(dealCount);
  }, [deals, calculateTotalALP, countDeals, onALPChange, onDealsChange]);

  // Handle deal amount change
  const handleDealChange = (id: string, amount: string) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, amount } : d));
  };

  // Handle frequency toggle
  const handleFrequencyChange = (id: string, frequency: "monthly" | "annual") => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, frequency } : d));
  };

  // Commit the current deal (move it to "committed" by appending a new empty row)
  const commitDeal = useCallback(() => {
    if (!activeDeal) return;
    const amount = parseFloat(activeDeal.amount) || 0;
    if (amount <= 0) return;

    // Append a new empty deal row, making the current one "committed"
    setDeals(prev => [
      ...prev,
      { id: crypto.randomUUID(), amount: "", frequency: "monthly" }
    ]);

    // Focus the new input after a brief delay
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [activeDeal]);

  // Remove a committed deal
  const removeDeal = (id: string) => {
    setDeals(prev => {
      const newDeals = prev.filter(d => d.id !== id);
      // Always keep at least one row (the active draft)
      if (newDeals.length === 0) {
        return [{ id: crypto.randomUUID(), amount: "", frequency: "monthly" }];
      }
      return newDeals;
    });
  };

  // Handle Enter key to commit deal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation(); // Prevent form submission
      commitDeal();
    }
  };

  const totalALP = calculateTotalALP(deals);
  const dealCount = countDeals(deals);
  const hasValidInput = parseFloat(activeDeal?.amount || "0") > 0;

  return (
    <div className="space-y-3">
      {/* Deal Bubbles - Animated chips for COMMITTED deals only */}
      {committedDeals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {committedDeals.map((deal, index) => (
              <motion.div
                key={deal.id}
                layout
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: -10 }}
                transition={{ 
                  type: "spring", 
                  stiffness: 500, 
                  damping: 25,
                  delay: index * 0.05 
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold",
                  "bg-gradient-to-r from-primary/20 to-accent/20",
                  "border border-primary/30 shadow-sm"
                )}
              >
                <span className="text-primary">#{index + 1}</span>
                <span className="text-foreground">
                  ${getDealALP(deal).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => removeDeal(deal.id)}
                  className="ml-0.5 h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Current Deal Input Row - Always visible */}
      {activeDeal && (
        <motion.div
          key={activeDeal.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2"
        >
          {/* Deal Number Badge */}
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
            {committedDeals.length + 1}
          </div>

          {/* Premium Input */}
          <div className="relative flex-1">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              data-deal-id={activeDeal.id}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              placeholder="Enter premium..."
              value={activeDeal.amount}
              onChange={(e) => {
                // Only allow numeric input
                const value = e.target.value.replace(/[^0-9.]/g, '');
                handleDealChange(activeDeal.id, value);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDeal();
                }
              }}
              onFocus={(e) => e.target.select()}
              className="pl-9 pr-2 h-12 text-lg font-semibold"
            />
          </div>

          {/* Frequency Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
            <button
              type="button"
              onClick={() => handleFrequencyChange(activeDeal.id, "monthly")}
              className={cn(
                "px-3 py-2.5 text-xs font-medium transition-all",
                activeDeal.frequency === "monthly"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              ×12
            </button>
            <button
              type="button"
              onClick={() => handleFrequencyChange(activeDeal.id, "annual")}
              className={cn(
                "px-3 py-2.5 text-xs font-medium transition-all",
                activeDeal.frequency === "annual"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              AOP
            </button>
          </div>

          {/* Add Button */}
          <button
            type="button"
            onClick={commitDeal}
            disabled={!hasValidInput}
            className={cn(
              "h-12 px-4 rounded-lg font-bold text-sm transition-all flex items-center gap-1",
              hasValidInput
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </motion.div>
      )}

      {/* ALP Summary */}
      {totalALP > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20"
        >
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Check className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">
              {dealCount} {dealCount === 1 ? "Deal" : "Deals"}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground block">Total ALP</span>
            <motion.p 
              key={totalALP}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              className="text-2xl font-bold text-primary"
            >
              ${Math.round(totalALP).toLocaleString()}
            </motion.p>
          </div>
        </motion.div>
      )}

      {/* Tip */}
      <p className="text-[10px] text-muted-foreground text-center">
        💡 Press Enter or click "+ Add" after entering premium to add another deal
      </p>
    </div>
  );
}
