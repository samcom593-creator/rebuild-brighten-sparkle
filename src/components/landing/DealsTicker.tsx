import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";

const carriers = [
  "American National", "Mutual of Omaha", "Transamerica", "Foresters",
  "Athene", "National Life", "Americo", "F&G", "Prosperity",
  "American Equity", "North American", "Nationwide", "Ethos",
  "American Amicable", "Aflac", "American Home Life", "Royal Neighbors",
  "Guarantee Trust Life", "Newbridge",
];

const deals = [
  { agent: "MOODY", amount: "$3,324", color: "text-emerald-400" },
  { agent: "CHUDI", amount: "$2,575", color: "text-cyan-400" },
  { agent: "KJ", amount: "$3,441", color: "text-amber-400" },
  { agent: "OBI", amount: "$5,189", color: "text-rose-400" },
  { agent: "JACOB", amount: "$4,174", color: "text-violet-400" },
  { agent: "AISHA", amount: "$1,559", color: "text-emerald-400" },
  { agent: "XAVIAR", amount: "$2,483", color: "text-sky-400" },
  { agent: "SAMUEL", amount: "$1,430", color: "text-orange-400" },
  { agent: "DALTON", amount: "$1,430", color: "text-pink-400" },
  { agent: "MARCOS", amount: "$1,775", color: "text-teal-400" },
  { agent: "WENDELL", amount: "$1,325", color: "text-lime-400" },
  { agent: "LUIS", amount: "$840", color: "text-fuchsia-400" },
  { agent: "DUDLEY", amount: "$1,847", color: "text-indigo-400" },
];

export function DealsTicker() {
  const [carrierIndex, setCarrierIndex] = useState(0);
  const [dealIndex, setDealIndex] = useState(0);
  const [showDeal, setShowDeal] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Alternate: deal for 2.5s → carrier for 2.5s
    let tick = 0;
    const run = () => {
      intervalRef.current = setInterval(() => {
        tick++;
        if (tick % 2 === 1) {
          // Show deal
          setDealIndex((prev) => (prev + 1) % deals.length);
          setShowDeal(true);
        } else {
          // Show carrier
          setCarrierIndex((prev) => (prev + 1) % carriers.length);
          setShowDeal(false);
        }
      }, 2500);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      } else if (!intervalRef.current) {
        run();
      }
    };

    run();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const deal = deals[dealIndex];

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-black h-8 overflow-hidden flex items-center justify-center">
      <AnimatePresence mode="wait">
        {showDeal ? (
          <motion.div
            key={`deal-${dealIndex}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2 text-sm"
          >
            <span className="text-white/50">🔥</span>
            <span className={`font-bold ${deal.color}`}>{deal.agent}</span>
            <span className="text-white/40">closed</span>
            <span className={`font-black ${deal.color}`}>{deal.amount}</span>
            <span className="text-white/40">ALP</span>
          </motion.div>
        ) : (
          <motion.div
            key={`carrier-${carrierIndex}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-3 text-sm"
          >
            <span className="text-amber-400">🔥</span>
            <span className="text-white/60 font-medium">Our agents write with</span>
            <span className="text-primary font-bold">{carriers[carrierIndex]}</span>
            <span className="text-white/60 font-medium">& more</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
