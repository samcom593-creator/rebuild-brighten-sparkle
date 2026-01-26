import { forwardRef, useEffect, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

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
    const [displayValue, setDisplayValue] = useState(0);

    const spring = useSpring(0, {
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
      spring.set(value);
    }, [value, spring]);

    useEffect(() => {
      const unsubscribe = display.on("change", (v) => {
        setDisplayValue(v as any);
      });
      return () => unsubscribe();
    }, [display]);

    return (
      <motion.span
        ref={ref}
        className={className}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        {prefix}
        {displayValue}
        {suffix}
      </motion.span>
    );
  }
);
