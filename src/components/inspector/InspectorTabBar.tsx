import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { TAB_BAR_CLASS, tabCellClass } from "@/components/tabs/tabStyles";
import { splitTabs, type InspectorTabId } from "./inspectorTabs";

interface InspectorTabLabel {
  label: string;
  badge?: ReactNode;
}

interface InspectorTabBarProps {
  order: InspectorTabId[];
  activeTab: InspectorTabId;
  labels: Record<InspectorTabId, InspectorTabLabel>;
  onSelect: (id: InspectorTabId) => void;
  trailing?: ReactNode;
}

function TabContent({ label, badge }: InspectorTabLabel) {
  return (
    <>
      <span className="truncate">{label}</span>
      {badge}
    </>
  );
}

export function InspectorTabBar({
  order,
  activeTab,
  labels,
  onSelect,
  trailing,
}: InspectorTabBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuReference = useRef<HTMLDivElement>(null);
  const { visible, overflow } = splitTabs(order);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (e.target instanceof Node && menuReference.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={`${TAB_BAR_CLASS} min-w-0`}>
      <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        {visible.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            title={labels[id].label}
            className={`min-w-0 ${tabCellClass(id === activeTab)}`}
          >
            <TabContent {...labels[id]} />
          </button>
        ))}

        <div className="ml-auto flex shrink-0 items-center px-2">{trailing}</div>
      </div>

      <div className="relative flex h-full shrink-0 items-stretch" ref={menuReference}>
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className={`border-border/80 flex cursor-pointer items-center border-l px-3 transition-colors ${
            isOpen
              ? "bg-muted/60 text-foreground"
              : "text-foreground/80 hover:bg-muted/40 hover:text-foreground"
          }`}
          title="More tabs"
        >
          <ChevronDown
            strokeWidth={2.5}
            className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="border-border/80 bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-px min-w-36 rounded-sm border py-1 shadow-md">
            {overflow.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onSelect(id);
                  setIsOpen(false);
                }}
                className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex w-full cursor-pointer items-center px-2 py-1.5 text-left text-xs transition-colors"
              >
                <TabContent {...labels[id]} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
