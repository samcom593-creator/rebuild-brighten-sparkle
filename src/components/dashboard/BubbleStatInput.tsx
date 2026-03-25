import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BubbleStatInputProps {
  label: string;
  emoji: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  delay?: number;
}

export function BubbleStatInput({ 
  label, 
  emoji, 
  value, 
  onChange, 
  step = 1,
  delay = 0 
}: BubbleStatInputProps) {
  const hasValue = value > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="relative"
    >
      <div 
        className={cn(
          "relative p-4 rounded-xl border-2 transition-all duration-300",
          "bg-gradient-to-br from-background to-muted/20",
          "hover:border-primary/30 hover:shadow-md",
          hasValue && "border-primary/40 bg-primary/5 shadow-lg shadow-primary/10",
          !hasValue && "border-border/40"
        )}
      >
        {/* Label */}
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
          {label}
        </label>
        
        {/* Input with emoji */}
        <div className="relative flex items-center">
          <div className={cn(
            "absolute left-0 h-10 w-10 rounded-lg flex items-center justify-center text-xl",
            hasValue ? "bg-primary/10" : "bg-muted/50"
          )}>
            {emoji}
          </div>
          <Input
            type="number"
            step={step}
            min="0"
            inputMode="decimal"
            pattern="[0-9]*"
            value={value || ""}
            placeholder="0"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "" || raw === "0") { onChange(0); return; }
              onChange(step < 1 ? parseFloat(raw) || 0 : parseInt(raw) || 0);
            }}
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-12 text-2xl font-bold text-center pl-12 border-0 bg-transparent focus:ring-0",
              hasValue && "text-foreground"
            )}
          />
        </div>
        
        {/* Active indicator dot */}
        {hasValue && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-primary shadow-lg shadow-primary/50"
          />
        )}
      </div>
    </motion.div>
  );
}
