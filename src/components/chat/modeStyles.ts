import type { ExecutionMode } from "@/types";

export interface ModeStyle {
  trigger: string;
  label: string;
  chevron: string;
  item: string;
  itemSelected: string;
  itemLabel: string;
  itemLabelSelected: string;
  description: string;
  check: string;
}

export const MODE_STYLES: Record<ExecutionMode, ModeStyle> = {
  restricted: {
    trigger: "text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground font-normal",
    label: "text-muted-foreground/70 font-medium",
    chevron: "text-muted-foreground/50",
    item: "text-muted-foreground/70 hover:bg-muted/40 hover:text-muted-foreground",
    itemSelected: "bg-muted/60 text-muted-foreground font-medium",
    itemLabel: "text-muted-foreground/70",
    itemLabelSelected: "text-muted-foreground font-medium",
    description: "text-muted-foreground/50",
    check: "text-muted-foreground",
  },
  read: {
    trigger: "font-medium text-blue-400 hover:bg-blue-500/15",
    label: "font-medium text-blue-400",
    chevron: "text-blue-400/80",
    item: "text-blue-400/80 hover:bg-blue-500/10 hover:text-blue-300",
    itemSelected: "bg-blue-500/15 font-medium text-blue-300",
    itemLabel: "text-blue-400/80",
    itemLabelSelected: "font-medium text-blue-400",
    description: "text-blue-400/60",
    check: "text-blue-400",
  },
  write: {
    trigger: "font-medium text-purple-400 hover:bg-purple-500/15",
    label: "font-medium text-purple-400",
    chevron: "text-purple-400/80",
    item: "text-purple-400/80 hover:bg-purple-500/10 hover:text-purple-300",
    itemSelected: "bg-purple-500/15 font-medium text-purple-300",
    itemLabel: "text-purple-400/80",
    itemLabelSelected: "font-medium text-purple-400",
    description: "text-purple-400/60",
    check: "text-purple-400",
  },
  god: {
    trigger: "font-medium text-amber-400 hover:bg-amber-500/15",
    label: "font-medium text-amber-400",
    chevron: "text-amber-400/80",
    item: "text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-300",
    itemSelected: "bg-amber-500/15 font-medium text-amber-300",
    itemLabel: "text-amber-400/80",
    itemLabelSelected: "font-medium text-amber-400",
    description: "text-amber-400/60",
    check: "text-amber-400",
  },
};
