import { Children, useEffect, useRef, useState, type ReactNode } from "react";

export default function ScreenNavigation({
  screen,
  children,
}: {
  screen: string;
  children: ReactNode;
}) {
  const navigation = useRef<HTMLElement>(null);
  const count = Children.count(children);
  const [indicator, setIndicator] = useState({ width: 100, left: 0 });
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    function updateIndicator() {
      if (!nav) return;
      const width = Math.min(100, (nav.clientWidth / nav.scrollWidth) * 100);
      const left = Math.max(
        0,
        Math.min(100 - width, (nav.scrollLeft / nav.scrollWidth) * 100),
      );
      setIndicator((previous) =>
        previous.width === width && previous.left === left
          ? previous
          : { width, left },
      );
    }
    function revealSelection() {
      if (!nav) return;
      const overflow = nav.scrollWidth > nav.clientWidth;
      updateIndicator();
      if (!overflow) return;
      const selected = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) return;
      const bounds = nav.getBoundingClientRect();
      const button = selected.getBoundingClientRect();
      const delta =
        button.left < bounds.left
          ? button.left - bounds.left
          : button.right > bounds.right
            ? button.right - bounds.right
            : 0;
      if (delta)
        nav.scrollTo({ left: nav.scrollLeft + delta, behavior: "auto" });
    }
    nav.addEventListener("scroll", updateIndicator, { passive: true });
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(nav);
    for (const child of nav.children) observer.observe(child);
    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", updateIndicator);
    };
  }, [screen, count]);
  return (
    <>
      <nav ref={navigation} aria-label="画面切り替え">
        {children}
      </nav>
      {indicator.width < 100 && (
        <div className="navigation-scroll-track" aria-hidden="true">
          <span
            className="navigation-scroll-thumb"
            style={{ width: `${indicator.width}%`, left: `${indicator.left}%` }}
          />
        </div>
      )}
    </>
  );
}
