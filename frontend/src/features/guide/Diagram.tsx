import type { Mermaid } from "mermaid";
import { useEffect, useRef, useState } from "react";

/**
 * Mermaid, loaded the first time the guide shows a diagram, and only then. It draws
 * under the page's policy, with no eval. "strict" lets no diagram run scripts or links of its
 * own.
 */
let loading: Promise<Mermaid> | null = null;
function mermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then(({ default: drawer }) => {
    drawer.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      fontFamily: "inherit",
    });
    return drawer;
  });
  return loading;
}

let drawn = 0;

/** A diagram written in the guide as Mermaid, drawn as GitHub draws it. If it can't be, its
 *  text is shown, which still reads as a list of steps. */
export function Diagram({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    drawn += 1;
    const id = `guide-diagram-${drawn}`;
    mermaid()
      .then((drawer) => drawer.render(id, text))
      .then(({ svg }) => {
        if (current && box.current) box.current.innerHTML = svg;
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [text]);

  if (failed) return <pre className="guide-diagram-text">{text}</pre>;
  return <div ref={box} className="guide-diagram" role="img" aria-label="A diagram" />;
}
