import { forwardRef, useEffect, useRef } from "react";
import { motion, useSpring, useTransform, useMotionValue } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  formatAsCurrency?: boolean;
}

export const AnimatedNumber = forwardRef<HTMLSpanElement, AnimatedNumberProps>(
  function AnimatedNumber(
    {
      value,
      duration = 1,
      className = "",
      prefix = "",
      suffix = "",
      decimals = 0,
      formatAsCurrency = false,
    },
    ref
  ) {
    const displayRef = useRef<HTMLSpanElement>(null);
    
    const motionValue = useMotionValue(0);
    
    const spring = useSpring(motionValue, {
      stiffness: 100,
      damping: 30,
      duration: duration * 1000,
    });

    const display = useTransform(spring, (current) => {
      if (formatAsCurrency) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(Math.round(current));
      }
      return current.toFixed(decimals);
    });

    useEffect(() => {
      motionValue.set(value);
    }, [value, motionValue]);

    // Update the DOM directly without causing re-renders
    useEffect(() => {
      const unsubscribe = display.on("change", (v) => {
        if (displayRef.current) {
          displayRef.current.textContent = `${prefix}${v}${suffix}`;
        }
      });
      return () => unsubscribe();
    }, [display, prefix, suffix]);

    return (
      <motion.span
        ref={ref}
        className={className}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <span ref={displayRef}>
          {prefix}
          {formatAsCurrency
            ? new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              }).format(0)
            : (0).toFixed(decimals)}
          {suffix}
        </span>
      </motion.span>
    );
  }
);
