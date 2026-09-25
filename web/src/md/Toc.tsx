import { useCallback, useEffect, useState } from "react";
import type { TocItem } from "../lib/toc";

const TOC_LABEL = "On this page";
const TOC_NARROW_MQ = "(max-width: 959px)";
const SCROLL_SPY_OFFSET = 48;

type TocProps = {
  items: TocItem[];
  /** Bumps when markdown HTML is repainted so scroll-spy rebinds. */
  contentVersion: string;
};

export function Toc({ items, contentVersion }: TocProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    setActiveId(items[0]?.id ?? null);
  }, [items]);

  useEffect(() => {
    if (userToggled || !items.length) return;
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(TOC_NARROW_MQ);
    const sync = () => setCollapsed(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [items.length, userToggled]);

  useEffect(() => {
    if (!items.length || !contentVersion) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      let current = items[0]?.id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= SCROLL_SPY_OFFSET) current = item.id;
      }
      if (current) setActiveId(current);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, [items, contentVersion]);

  const onToggle = useCallback(() => {
    setUserToggled(true);
    setCollapsed((c) => !c);
  }, []);

  const onLinkClick = useCallback((item: TocItem, ev: React.MouseEvent) => {
    ev.preventDefault();
    const target = document.getElementById(item.id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", "#" + item.id);
    setActiveId(item.id);
  }, []);

  if (!items.length) return null;

  return (
    <aside
      id="toc"
      className={`toc${collapsed ? " toc-collapsed" : ""}${userToggled ? " toc-user-toggled" : ""}`}
    >
      <div className="toc-header">
        <span className="toc-title">{TOC_LABEL}</span>
        <button
          type="button"
          id="toc-toggle"
          className="toc-toggle mino-icon-button"
          aria-expanded={collapsed ? "false" : "true"}
          aria-controls="toc-nav"
          onClick={onToggle}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      <nav id="toc-nav" className="toc-nav" aria-label={TOC_LABEL}>
        {items.map((item) => (
          <a
            key={item.id}
            href={"#" + item.id}
            className={`mino-list-row toc-link toc-level-${item.level}${activeId === item.id ? " active" : ""}`}
            onClick={(ev) => onLinkClick(item, ev)}
          >
            {item.text || item.id}
          </a>
        ))}
      </nav>
    </aside>
  );
}
