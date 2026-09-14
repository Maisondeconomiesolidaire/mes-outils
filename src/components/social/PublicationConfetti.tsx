import { useEffect, useRef } from "react";

/** A short celebration after confirmed delivery, respecting reduced motion. */
export function PublicationConfetti({ burst }: { burst: number }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = container.current;
    if (!burst || !root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#1877f2", "#e1306c", "#42c76b", "#fbbf24", "#8b5cf6"];
    const animations: Animation[] = [];
    for (let index = 0; index < 90; index++) {
      const piece = document.createElement("span");
      const fromLeft = index % 2 === 0;
      Object.assign(piece.style, { position: "absolute", width: "8px", height: "12px", borderRadius: "2px", background: colors[index % colors.length], left: fromLeft ? "15%" : "85%", top: "60%" });
      root.append(piece);
      const distance = (0.1 + Math.random() * 0.6) * window.innerWidth * (fromLeft ? 1 : -1);
      animations.push(piece.animate([
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${distance * 0.6}px, ${-window.innerHeight * (0.25 + Math.random() * 0.4)}px) rotate(240deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${distance}px, ${window.innerHeight * 0.5}px) rotate(650deg)`, opacity: 0 },
      ], { duration: 1800 + Math.random() * 700, easing: "cubic-bezier(.15,.55,.45,1)", fill: "forwards" }));
    }
    const timeout = window.setTimeout(() => root.replaceChildren(), 2600);
    return () => { window.clearTimeout(timeout); animations.forEach(animation => animation.cancel()); root.replaceChildren(); };
  }, [burst]);
  return <div ref={container} aria-hidden="true" data-publication-confetti className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" />;
}
