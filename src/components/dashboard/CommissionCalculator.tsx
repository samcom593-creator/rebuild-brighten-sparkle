import { useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, TrendingUp, Award, Zap } from "lucide-react";
import { Slider } from "@/components/ui/slider";

const tiers = [
  { label: "Agent", rate: 0.55 },
  { label: "Senior Agent", rate: 0.65 },
  { label: "Manager", rate: 0.75 },
  { label: "Senior Manager", rate: 0.85 },
];

const targets = [
  { name: "Bronze", min: 2000, color: "#cd7f32" },
  { name: "Silver", min: 5000, color: "#c0c0c0" },
  { name: "Gold", min: 10000, color: "#f59e0b" },
  { name: "Diamond", min: 20000, color: "#22d3a5" },
];

export function CommissionCalculator() {
  const [weeklyAlp, setWeeklyAlp] = useState(5000);
  const [tierIndex, setTierIndex] = useState(0);

  const tier = tiers[tierIndex];
  const weeklyCommission = weeklyAlp * tier.rate;
  const monthlyCommission = weeklyCommission * 4.33;
  const yearlyPace = weeklyCommission * 52;
  const avgDealAlp = weeklyAlp > 0 ? weeklyAlp / 4 : 0; // assume ~4 deals/week
  const commissionPerDeal = avgDealAlp * tier.rate;

  const currentTarget = targets.reduce((best, t) => (weeklyAlp >= t.min ? t : best), targets[0]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] p-6 md:p-8"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[#22d3a5]/10 flex items-center justify-center">
          <DollarSign className="h-5 w-5 text-[#22d3a5]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[#f1f5f9] font-display">Commission Calculator</h3>
          <p className="text-xs text-[#64748b]">See your earning potential</p>
        </div>
      </div>

      {/* Tier Selector */}
      <div className="mb-6">
        <label className="text-xs text-[#64748b] uppercase tracking-wider font-display font-semibold mb-2 block">
          Your Level
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {tiers.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTierIndex(i)}
              className={`px-3 py-2 rounded-lg text-xs font-bold font-display transition-all duration-200 ${
                tierIndex === i
                  ? "bg-[#22d3a5] text-[#030712]"
                  : "bg-[#1e293b] text-[#94a3b8] hover:bg-[#334155]"
              }`}
            >
              {t.label} ({Math.round(t.rate * 100)}%)
            </button>
          ))}
        </div>
      </div>

      {/* Weekly ALP Slider */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs text-[#64748b] uppercase tracking-wider font-display font-semibold">
            Weekly ALP
          </label>
          <span className="text-2xl font-extrabold text-[#22d3a5] font-display">
            ${weeklyAlp.toLocaleString()}
          </span>
        </div>
        <Slider
          value={[weeklyAlp]}
          onValueChange={(v) => setWeeklyAlp(v[0])}
          min={0}
          max={30000}
          step={500}
          className="w-full"
        />
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-[#475569]">$0</span>
          <span className="text-[10px] text-[#475569]">$30,000</span>
        </div>
      </div>

      {/* Results Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg bg-[#1e293b]/50 p-4 text-center">
          <Zap className="h-5 w-5 text-[#22d3a5] mx-auto mb-1" />
          <div className="text-2xl font-extrabold text-[#f1f5f9] font-display">
            ${Math.round(weeklyCommission).toLocaleString()}
          </div>
          <p className="text-xs text-[#64748b]">Weekly Commission</p>
        </div>
        <div className="rounded-lg bg-[#1e293b]/50 p-4 text-center">
          <TrendingUp className="h-5 w-5 text-[#22d3a5] mx-auto mb-1" />
          <div className="text-2xl font-extrabold text-[#f1f5f9] font-display">
            ${Math.round(monthlyCommission).toLocaleString()}
          </div>
          <p className="text-xs text-[#64748b]">Monthly Commission</p>
        </div>
        <div className="rounded-lg bg-[#1e293b]/50 p-4 text-center">
          <Award className="h-5 w-5 text-[#f59e0b] mx-auto mb-1" />
          <div className="text-2xl font-extrabold text-[#f59e0b] font-display">
            ${Math.round(yearlyPace).toLocaleString()}
          </div>
          <p className="text-xs text-[#64748b]">Yearly Pace</p>
        </div>
      </div>

      {/* Per-Deal Breakdown */}
      <div className="flex items-center justify-between rounded-lg bg-[#1e293b]/30 px-4 py-3 mb-6">
        <span className="text-xs text-[#94a3b8]">Avg ALP/deal: <span className="text-[#f1f5f9] font-bold">${Math.round(avgDealAlp).toLocaleString()}</span></span>
        <span className="text-xs text-[#94a3b8]">Commission/deal: <span className="text-[#22d3a5] font-bold">${Math.round(commissionPerDeal).toLocaleString()}</span></span>
      </div>

      {/* Tier Targets */}
      <div className="grid grid-cols-4 gap-2">
        {targets.map((t) => (
          <div
            key={t.name}
            className={`rounded-lg p-2 text-center border transition-all duration-300 ${
              currentTarget.name === t.name
                ? "scale-105"
                : "opacity-50 border-transparent"
            }`}
            style={{
              borderColor: currentTarget.name === t.name ? t.color : "transparent",
              background: currentTarget.name === t.name ? `${t.color}15` : "transparent",
            }}
          >
            <div className="text-xs font-bold font-display" style={{ color: t.color }}>
              {t.name}
            </div>
            <div className="text-[10px] text-[#64748b]">${(t.min / 1000).toFixed(0)}K/wk</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
