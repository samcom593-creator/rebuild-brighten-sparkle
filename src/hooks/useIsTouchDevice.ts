import { useState, useEffect } from "react";

/**
 * Detects if the current device supports touch input
 * Used to disable tooltips on touch devices to prevent interaction issues
 */
export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    // Check for touch support
    const hasTouch = 
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      // @ts-ignore - msMaxTouchPoints exists on older IE/Edge
      navigator.msMaxTouchPoints > 0;
    
    // Also check media query for fine pointer (mouse/trackpad)
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
    
    // It's a touch device if it has touch AND doesn't have a fine pointer
    // OR if it only has touch (no fine pointer)
    setIsTouch(hasTouch && !hasFinePointer);
  }, []);

  return isTouch;
}
