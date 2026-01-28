import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, DollarSign, Check, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Deal {
  id: string;
  amount: string;
  frequency: "monthly" | "annual";
}

interface BubbleDealEntryProps {
  onALPChange: (alp: number) => void;
  onDealsChange: (deals: number) => void;
  initialDeals?: Deal[];
}

export function BubbleDealEntry({ onALPChange, onDealsChange, initialDeals }: BubbleDealEntryProps) {
  const [deals, setDeals] = useState<Deal[]>(
    initialDeals || [{ id: crypto.randomUUID(), amount: "", frequency: "monthly" }]
  );
  const [showInput, setShowInput] = useState(true);

  // Calculate total ALP from deals
  const calculateTotalALP = useCallback((dealList: Deal[]) => {
    return dealList.reduce((total, deal) => {
      const amount = parseFloat(deal.amount) || 0;
      if (amount <= 0) return total;
      const annualAmount = deal.frequency === "monthly" ? amount * 12 : amount;
      return total + annualAmount;
    }, 0);
  }, []);

  // Count deals with valid amounts
  const countDeals = useCallback((dealList: Deal[]) => {
    return dealList.filter(d => parseFloat(d.amount) > 0).length;
  }, []);

  // Get completed deals for bubble display
  const completedDeals = deals.filter(d => parseFloat(d.amount) > 0);

  // Notify parent of changes
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

  // Add new deal
  const addDeal = () => {
    const newDeal = { id: crypto.randomUUID(), amount: "", frequency: "monthly" as const };
    setDeals(prev => [...prev, newDeal]);
    setShowInput(true);
  };

  // Confirm current deal and prepare for next
  const confirmDeal = (id: string) => {
    const deal = deals.find(d => d.id === id);
    if (deal && parseFloat(deal.amount) > 0) {
      // Add new empty deal for next entry
      addDeal();
    }
  };

  // Remove deal
  const removeDeal = (id: string) => {
    setDeals(prev => {
      const newDeals = prev.filter(d => d.id !== id);
      // Always keep at least one deal input
      if (newDeals.length === 0 || newDeals.every(d => parseFloat(d.amount) > 0)) {
        newDeals.push({ id: crypto.randomUUID(), amount: "", frequency: "monthly" });
      }
      return newDeals;
    });
  };

  // Handle Enter key to add new deal
  const handleKeyDown = (e: React.KeyboardEvent, dealId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmDeal(dealId);
    }
  };

  // Get ALP for a single deal
  const getDealALP = (deal: Deal) => {
    const amount = parseFloat(deal.amount) || 0;
    return deal.frequency === "monthly" ? amount * 12 : amount;
  };

  const totalALP = calculateTotalALP(deals);
  const dealCount = countDeals(deals);
  const currentEmptyDeal = deals.find(d => !parseFloat(d.amount));

  return (
    <div className="space-y-4">
      {/* Completed Deal Bubbles */}
      {completedDeals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {completedDeals.map((deal, index) => (
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
                  delay: index * 0.03 
                }}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-full",
                  "bg-gradient-to-r from-primary/15 to-accent/15",
                  "border-2 border-primary/30 shadow-lg shadow-primary/10",
                  "backdrop-blur-sm"
                )}
              >
                <span className="text-xs font-bold text-primary">#{index + 1}</span>
                <span className="text-sm font-bold text-foreground">
                  ${getDealALP(deal).toLocaleString()}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase">
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

      {/* Current Deal Input */}
      {currentEmptyDeal && (
        <motion.div
          key={currentEmptyDeal.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2"
        >
          {/* Deal Number Badge */}
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary shrink-0 shadow-lg">
            {completedDeals.length + 1}
          </div>

          {/* Premium Input */}
          <div className="relative flex-1">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="Monthly premium..."
              value={currentEmptyDeal.amount}
              onChange={(e) => handleDealChange(currentEmptyDeal.id, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, currentEmptyDeal.id)}
              onFocus={(e) => e.target.select()}
              className="pl-10 h-14 text-xl font-bold border-2 border-primary/20 focus:border-primary/50 bg-background/50"
            />
          </div>

          {/* Frequency Toggle */}
          <div className="flex rounded-xl overflow-hidden border-2 border-primary/20 shrink-0">
            <button
              type="button"
              onClick={() => handleFrequencyChange(currentEmptyDeal.id, "monthly")}
              className={cn(
                "px-3 py-3 text-xs font-bold transition-all",
                currentEmptyDeal.frequency === "monthly"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              ×12
            </button>
            <button
              type="button"
              onClick={() => handleFrequencyChange(currentEmptyDeal.id, "annual")}
              className={cn(
                "px-3 py-3 text-xs font-bold transition-all",
                currentEmptyDeal.frequency === "annual"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              AOP
            </button>
          </div>
        </motion.div>
      )}

      {/* Add Deal Button (show when all deals are completed) */}
      {!currentEmptyDeal && completedDeals.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Button
            type="button"
            variant="outline"
            onClick={addDeal}
            className="w-full h-12 border-2 border-dashed border-primary/30 hover:border-primary/50 hover:bg-primary/5"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Another Deal
          </Button>
        </motion.div>
      )}

      {/* ALP Summary */}
      {totalALP > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 border-2 border-primary/20"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Check className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="text-lg font-bold">
                {dealCount} {dealCount === 1 ? "Deal" : "Deals"}
              </span>
              <p className="text-xs text-muted-foreground">Logged today</p>
            </div>
          </div>
          <div className="text-right">
            <motion.p 
              key={totalALP}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              className="text-3xl font-bold text-primary"
            >
              ${Math.round(totalALP).toLocaleString()}
            </motion.p>
            <span className="text-xs text-muted-foreground">Total ALP</span>
          </div>
        </motion.div>
      )}

      {/* Tip */}
      <p className="text-[10px] text-muted-foreground text-center">
        💡 Press Enter after entering premium to add another deal
      </p>
    </div>
  );
}
