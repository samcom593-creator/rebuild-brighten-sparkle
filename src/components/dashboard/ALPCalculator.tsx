import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Calculator, DollarSign, Calendar, Zap, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [mode, setMode] = useState<"quick" | "calculate">(initialALP > 0 ? "quick" : "calculate");
  const [quickALP, setQuickALP] = useState(initialALP.toString());
  const [deals, setDeals] = useState<Deal[]>([
    { id: crypto.randomUUID(), amount: "", frequency: "monthly" }
  ]);

  // Calculate total ALP from deals
  const calculateTotalALP = useCallback((dealList: Deal[]) => {
    return dealList.reduce((total, deal) => {
      const amount = parseFloat(deal.amount) || 0;
      if (amount <= 0) return total;
      
      // Monthly premium × 12 = Annual, or just use annual as-is
      const annualAmount = deal.frequency === "monthly" ? amount * 12 : amount;
      return total + annualAmount;
    }, 0);
  }, []);

  // Count deals with valid amounts
  const countDeals = useCallback((dealList: Deal[]) => {
    return dealList.filter(d => parseFloat(d.amount) > 0).length;
  }, []);

  // Handle deal amount change
  const handleDealChange = (id: string, amount: string) => {
    const newDeals = deals.map(d => d.id === id ? { ...d, amount } : d);
    setDeals(newDeals);
    
    const totalALP = calculateTotalALP(newDeals);
    const dealCount = countDeals(newDeals);
    
    onALPChange(totalALP);
    onDealsChange(dealCount);
  };

  // Handle frequency toggle
  const handleFrequencyChange = (id: string, frequency: "monthly" | "annual") => {
    const newDeals = deals.map(d => d.id === id ? { ...d, frequency } : d);
    setDeals(newDeals);
    
    const totalALP = calculateTotalALP(newDeals);
    onALPChange(totalALP);
  };

  // Add new deal row
  const addDeal = () => {
    setDeals([...deals, { id: crypto.randomUUID(), amount: "", frequency: "monthly" }]);
  };

  // Remove deal row
  const removeDeal = (id: string) => {
    if (deals.length <= 1) return;
    const newDeals = deals.filter(d => d.id !== id);
    setDeals(newDeals);
    
    const totalALP = calculateTotalALP(newDeals);
    const dealCount = countDeals(newDeals);
    
    onALPChange(totalALP);
    onDealsChange(dealCount);
  };

  // Handle quick mode ALP change
  const handleQuickALPChange = (value: string) => {
    setQuickALP(value);
    onALPChange(parseFloat(value) || 0);
  };

  // Handle Enter key to add new deal
  const handleKeyDown = (e: React.KeyboardEvent, dealId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const currentDeal = deals.find(d => d.id === dealId);
      if (currentDeal && parseFloat(currentDeal.amount) > 0) {
        addDeal();
        // Focus the new input after a short delay
        setTimeout(() => {
          const inputs = document.querySelectorAll('[data-deal-input]');
          const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
          lastInput?.focus();
        }, 50);
      }
    }
  };

  const totalALP = mode === "calculate" ? calculateTotalALP(deals) : (parseFloat(quickALP) || 0);
  const dealCount = mode === "calculate" ? countDeals(deals) : initialDeals;

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("calculate")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
            mode === "calculate" 
              ? "bg-primary text-primary-foreground shadow-md" 
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          <Calculator className="h-3.5 w-3.5" />
          Calculate ALP
        </button>
        <button
          type="button"
          onClick={() => setMode("quick")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
            mode === "quick" 
              ? "bg-primary text-primary-foreground shadow-md" 
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Quick Entry
        </button>
      </div>

      <AnimatePresence mode="wait">
        {mode === "calculate" ? (
          <motion.div
            key="calculate"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-2 overflow-hidden"
          >
            {/* Deal Rows */}
            {deals.map((deal, index) => (
              <motion.div
                key={deal.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-2"
              >
                {/* Deal Number Badge */}
                <div className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                  parseFloat(deal.amount) > 0 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted text-muted-foreground"
                )}>
                  {index + 1}
                </div>

                {/* Premium Input */}
                <div className="relative flex-1">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    data-deal-input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="Premium"
                    value={deal.amount}
                    onChange={(e) => handleDealChange(deal.id, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, deal.id)}
                    onFocus={(e) => e.target.select()}
                    className={cn(
                      "pl-8 pr-2 h-10 text-base font-semibold transition-all",
                      parseFloat(deal.amount) > 0 && "border-primary/40 bg-primary/5"
                    )}
                  />
                </div>

                {/* Frequency Toggle */}
                <div className="flex rounded-lg overflow-hidden border border-border/50 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange(deal.id, "monthly")}
                    className={cn(
                      "px-2.5 py-1.5 text-[10px] font-medium transition-all",
                      deal.frequency === "monthly"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    /mo
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange(deal.id, "annual")}
                    className={cn(
                      "px-2.5 py-1.5 text-[10px] font-medium transition-all",
                      deal.frequency === "annual"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    /yr
                  </button>
                </div>

                {/* Remove Button */}
                {deals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDeal(deal.id)}
                    className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </motion.div>
            ))}

            {/* Add Deal Button */}
            <motion.button
              type="button"
              onClick={addDeal}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all text-xs font-medium"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Another Deal
            </motion.button>

            {/* ALP Summary */}
            {totalALP > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
              >
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    {dealCount} {dealCount === 1 ? "Deal" : "Deals"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">Total ALP</span>
                  <p className="text-lg font-bold text-primary">
                    ${totalALP.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Tip */}
            <p className="text-[10px] text-muted-foreground text-center">
              💡 Press Enter after each deal to add another
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="quick"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5 font-medium">
              <DollarSign className="h-3 w-3" />
              Total ALP (Annual Life Premium)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0"
              value={quickALP}
              onChange={(e) => handleQuickALPChange(e.target.value)}
              onFocus={(e) => e.target.select()}
              className={cn(
                "h-14 text-xl font-bold text-center transition-all",
                parseFloat(quickALP) > 0 && "border-primary/40 bg-primary/5 text-primary ring-2 ring-primary/20"
              )}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
