import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";

const deals = [
  { name: "John M.", carrier: "American National", amount: "$45,000" },
  { name: "Sarah K.", carrier: "Mutual of Omaha", amount: "$62,000" },
  { name: "Marcus T.", carrier: "Transamerica", amount: "$38,500" },
  { name: "Jennifer L.", carrier: "Foresters", amount: "$55,200" },
  { name: "David R.", carrier: "Athene", amount: "$72,000" },
  { name: "Amanda W.", carrier: "National Life", amount: "$41,800" },
  { name: "Chris B.", carrier: "Americo", amount: "$58,400" },
  { name: "Lisa P.", carrier: "F&G", amount: "$49,000" },
  { name: "Michael J.", carrier: "Prosperity", amount: "$67,500" },
  { name: "Rachel H.", carrier: "American Equity", amount: "$43,200" },
  { name: "Kevin D.", carrier: "North American", amount: "$51,800" },
  { name: "Emily S.", carrier: "Nationwide", amount: "$39,900" },
];

// Carrier names for the rotating banner
const carriers = [
  "American National",
  "Mutual of Omaha", 
  "Transamerica",
  "Foresters",
  "Athene",
  "National Life",
  "Americo",
  "F&G",
  "Prosperity",
  "American Equity",
  "North American",
  "Nationwide",
  "Ethos",
  "American Amicable",
  "Aflac",
  "American Home Life",
];

export function DealsTicker() {
  const [currentCarrierIndex, setCurrentCarrierIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotate carrier name with dissolve effect and tab visibility guard
  useEffect(() => {
    const startInterval = () => {
      intervalRef.current = setInterval(() => {
        setCurrentCarrierIndex((prev) => (prev + 1) % carriers.length);
      }, 3000);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        if (!intervalRef.current) {
          startInterval();
        }
      }
    };

    startInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Duplicate deals for seamless loop
  const allDeals = [...deals, ...deals];

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-black h-8 overflow-hidden">
      <div className="ticker-animate flex items-center h-full whitespace-nowrap">
        {allDeals.map((deal, index) => (
          <div
            key={index}
            className="inline-flex items-center gap-2 px-6 text-sm"
          >
            <span className="text-amber-400">🔥</span>
            <span className="text-white font-medium">{deal.name}</span>
            <span className="text-white/50">•</span>
            <AnimatePresence mode="sync">
              <motion.span
                key={deal.carrier}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="text-white/80"
              >
                {deal.carrier}
              </motion.span>
            </AnimatePresence>
            <span className="text-white/50">•</span>
            <span className="text-primary font-bold">{deal.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
