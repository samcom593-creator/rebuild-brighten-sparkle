import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, DollarSign } from "lucide-react";
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
  const convertedInitialDeals: Deal[] = initialDeals?.map(d => ({
    id: d.id,
    premium: parseFloat(d.amount) || 0
  })).filter(d => d.premium > 0) || [];

  const [deals, setDeals] = useState<Deal[]>(convertedInitialDeals);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const totalALP = deals.reduce((sum, deal) => sum + deal.premium, 0);
  const dealCount = deals.length;

  useEffect(() => {
    onALPChange(totalALP);
    onDealsChange(dealCount);
  }, [totalALP, dealCount, onALPChange, onDealsChange]);

  const addDeal = useCallback(() => {
    const premium = parseFloat(inputValue);
    if (!premium || premium <= 0) return;

    const newDeal: Deal = {
      id: crypto.randomUUID(),
      premium
    };

    setDeals(prev => [...prev, newDeal]);
    setInputValue("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputValue]);

  const removeDeal = (id: string) => {
    setDeals(prev => prev.filter(d => d.id !== id));
  };

  // Removed - inline handler used instead for mobile safety

  const hasValidInput = parseFloat(inputValue) > 0;

  return (
    <div className="space-y-3">
      {/* Deal Bubbles - Minimal */}
      {deals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {deals.map((deal) => (
              <motion.div
                key={deal.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30"
              >
                <span className="text-sm font-bold text-foreground">
                  ${deal.premium.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => removeDeal(deal.id)}
                  className="h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Inline Input + Add Button */}
      <div className="flex border-2 border-border rounded-xl overflow-hidden focus-within:border-primary transition-colors">
        <div className="flex-1 flex items-center px-4 bg-background">
          <DollarSign className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            placeholder="Enter ALP"
            value={inputValue}
            onChange={(e) => {
              // Only allow numeric input
              const value = e.target.value.replace(/[^0-9.]/g, '');
              setInputValue(value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                addDeal();
              }
            }}
            onFocus={(e) => e.target.select()}
            className="flex-1 h-12 bg-transparent border-0 text-lg font-semibold placeholder:text-muted-foreground focus:outline-none px-2"
          />
        </div>
        <button
          type="button"
          onClick={addDeal}
          disabled={!hasValidInput}
          className={cn(
            "px-5 h-12 font-bold text-primary-foreground bg-primary transition-all",
            hasValidInput ? "hover:bg-primary/90" : "opacity-50 cursor-not-allowed"
          )}
        >
          + Add
        </button>
      </div>

      {/* Simple Total */}
      {totalALP > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-right"
        >
          <span className="text-2xl font-bold text-primary">
            Total: ${totalALP.toLocaleString()}
          </span>
        </motion.div>
      )}
    </div>
  );
}
