export const TAB_BAR_CLASS =
  "border-border/80 bg-muted/20 flex h-9 shrink-0 items-center border-b text-xs select-none";

export function tabCellClass(isActive: boolean): string {
  return `border-border/80 flex h-[calc(100%+1px)] cursor-pointer items-center gap-1.5 border-r px-3 transition-colors ${
    isActive
      ? "bg-background text-foreground border-b-background before:bg-primary relative border-b font-medium before:absolute before:inset-x-0 before:top-0 before:h-[2px]"
      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground border-b border-b-transparent"
  }`;
}
