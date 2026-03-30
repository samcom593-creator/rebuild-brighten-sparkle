import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";

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
  "Royal Neighbors",
  "Guarantee Trust Life",
  "Newbridge",
];

export function DealsTicker() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startInterval = () => {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % carriers.length);
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
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-black h-8 overflow-hidden flex items-center justify-center">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-amber-400">🔥</span>
        <span className="text-white/60 font-medium">Our agents write with</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={currentIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="text-primary font-bold min-w-[140px] text-center"
          >
            {carriers[currentIndex]}
          </motion.span>
        </AnimatePresence>
        <span className="text-white/60 font-medium">& more</span>
      </div>
    </div>
  );
}
