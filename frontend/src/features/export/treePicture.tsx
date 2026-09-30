import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { TreeSnapshot } from "@/features/tree/picture";

type Source = () => TreeSnapshot;
type Registry = { source: Source | null; setSource: (source: Source | null) => void };

const TreePictureContext = createContext<Registry>({ source: null, setSource: () => {} });

/** Lets the Export dialog in the top bar draw the tree the canvas is showing. */
export function TreePictureProvider({ children }: { children: ReactNode }) {
  const [source, setState] = useState<Source | null>(null);
  // A function in state must be wrapped, or React would call it as an updater.
  const setSource = useCallback((next: Source | null) => setState(() => next), []);
  const value = useMemo(() => ({ source, setSource }), [source, setSource]);
  return <TreePictureContext.Provider value={value}>{children}</TreePictureContext.Provider>;
}

/** How to draw the tree now, while a tree is on screen; otherwise null. */
export function useTreePicture(): Source | null {
  return useContext(TreePictureContext).source;
}

/** Called by the canvas: offers its tree to the Export dialog while it's shown. */
export function useOfferTreePicture(source: Source): void {
  const { setSource } = useContext(TreePictureContext);
  useEffect(() => {
    setSource(source);
    return () => setSource(null);
  }, [setSource, source]);
}
