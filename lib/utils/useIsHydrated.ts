import { useSyncExternalStore } from "react";

/** Never fires — hydration happens exactly once and never reverses. */
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * True once the client has hydrated, false during SSR and the first render.
 *
 * Use this to gate anything that would otherwise produce a hydration mismatch
 * (reading `localStorage`, the resolved colour scheme, `window`, …).
 *
 * `useSyncExternalStore` rather than the usual
 * `const [m, setM] = useState(false); useEffect(() => setM(true), [])`:
 * that pattern sets state synchronously inside an effect, which triggers a
 * second render pass for every consumer and is what `react-hooks/set-state-in-effect`
 * flags. This gets the same two-phase behaviour from React's own hydration
 * signal, with no extra render and no lint suppression.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
