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
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    function revealSelection() {
      if (!nav) return;
      const overflow = nav.scrollWidth > nav.clientWidth;
      setOverflowing(overflow);
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
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [screen, count]);
  return (
    <>
      <nav ref={navigation} aria-label="画面切り替え">
        {children}
      </nav>
      {overflowing && (
        <small className="navigation-hint">
          ← タブは左右にスクロールできます →
        </small>
      )}
    </>
  );
}
