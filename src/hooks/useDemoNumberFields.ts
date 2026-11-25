import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { demoNumberValues, EMPTY_PRODUCTION_DEMO, type DemoNumberScope, type ProductionDemoStore } from "@/lib/productionDemo";

export type { DemoNumberField } from "@/lib/productionDemo";
export const ProductionDemoContext = createContext<ProductionDemoStore | null>(null);
const subscribeToNothing = () => () => undefined;
const emptySnapshot = () => EMPTY_PRODUCTION_DEMO;

/** Register only figures currently visible to the caller. Returned numbers never alter query data. */
export function useDemoNumberFields({ scopeKey, label, fields }: DemoNumberScope): { values: Record<string, number>; isDemo: boolean } {
  const store = useContext(ProductionDemoContext);
  const token = useId();
  const registration = useRef<DemoNumberScope>({ scopeKey, label, fields });
  registration.current = { scopeKey, label, fields };
  const signature = JSON.stringify({ scopeKey, label, fields });
  const snapshot = useSyncExternalStore(store?.subscribe ?? subscribeToNothing, store?.getSnapshot ?? emptySnapshot, emptySnapshot);

  useEffect(() => () => store?.unregister(token), [store, token]);
  useEffect(() => { store?.register(token, registration.current); }, [store, token, signature]);

  return demoNumberValues(scopeKey, fields, snapshot.overrides);
}
