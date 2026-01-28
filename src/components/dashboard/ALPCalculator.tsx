import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Calculator, DollarSign, Zap, Check, Trash2 } from "lucide-react";
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
  const lastInputRef = useRef<HTMLInputElement>(null);

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

  // Get completed deals for bubble display
  const completedDeals = deals.filter(d => parseFloat(d.amount) > 0);

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
    const newDeal = { id: crypto.randomUUID(), amount: "", frequency: "monthly" as const };
    setDeals([...deals, newDeal]);
  };

  // Remove deal row
  const removeDeal = (id: string) => {
    const newDeals = deals.filter(d => d.id !== id);
    // Always keep at least one empty row
    if (newDeals.length === 0 || newDeals.every(d => parseFloat(d.amount) > 0)) {
      newDeals.push({ id: crypto.randomUUID(), amount: "", frequency: "monthly" });
    }
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
      }
    }
  };

  // Focus the last empty input when a new deal is added
  useEffect(() => {
    const lastEmptyDeal = deals.find(d => !d.amount);
    if (lastEmptyDeal) {
      const input = document.querySelector(`[data-deal-id="${lastEmptyDeal.id}"]`) as HTMLInputElement;
      input?.focus();
    }
  }, [deals.length]);

  const totalALP = mode === "calculate" ? calculateTotalALP(deals) : (parseFloat(quickALP) || 0);
  const dealCount = mode === "calculate" ? countDeals(deals) : initialDeals;

  // Get ALP for a single deal
  const getDealALP = (deal: Deal) => {
    const amount = parseFloat(deal.amount) || 0;
    return deal.frequency === "monthly" ? amount * 12 : amount;
  };

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
          Add Deals
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
            className="space-y-3 overflow-hidden"
          >
            {/* Deal Bubbles - Animated chips for completed deals */}
            {completedDeals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {completedDeals.map((deal, index) => (
                    <motion.div
                      key={deal.id}
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
                        "bg-gradient-to-r from-primary/20 to-emerald-500/20",
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

            {/* Current Deal Input Row */}
            {deals.filter(d => !parseFloat(d.amount)).slice(0, 1).map((deal) => (
              <motion.div
                key={deal.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2"
              >
                {/* Deal Number Badge */}
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                  {completedDeals.length + 1}
                </div>

                {/* Premium Input */}
                <div className="relative flex-1">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    data-deal-id={deal.id}
                    ref={lastInputRef}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="Enter premium..."
                    value={deal.amount}
                    onChange={(e) => handleDealChange(deal.id, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, deal.id)}
                    onFocus={(e) => e.target.select()}
                    className="pl-9 h-12 text-lg font-semibold"
                  />
                </div>

                {/* Frequency Toggle */}
                <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange(deal.id, "monthly")}
                    className={cn(
                      "px-3 py-2.5 text-xs font-medium transition-all",
                      deal.frequency === "monthly"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    ×12
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange(deal.id, "annual")}
                    className={cn(
                      "px-3 py-2.5 text-xs font-medium transition-all",
                      deal.frequency === "annual"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    AOP
                  </button>
                </div>
              </motion.div>
            ))}

            {/* ALP Summary */}
            {totalALP > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-primary/10 to-emerald-500/10 border border-primary/20"
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
              💡 Press Enter after entering premium to add another deal
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
