import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useLeadCounter() {
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCount = async () => {
      const { data } = await supabase
        .from("lead_counter")
        .select("count")
        .limit(1)
        .maybeSingle();
      
      if (data) {
        setCount(data.count);
      }
      setIsLoading(false);
    };

    fetchCount();
  }, []);

  return { count, isLoading };
}