import { GROUP_COLORS, GROUP_COLOR_KEYS, type GroupColor } from "@/types";

interface ColorSwatchesProperties {
  value: GroupColor;
  onChange: (color: GroupColor) => void;
}

export function ColorSwatches({ value, onChange }: ColorSwatchesProperties) {
  return (
    <div className="grid grid-cols-4 gap-1.5 px-3 py-1.5">
      {GROUP_COLOR_KEYS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          title={color}
          onClick={(e) => {
            e.stopPropagation();
            onChange(color);
          }}
          className={`size-4 cursor-pointer rounded-full ${GROUP_COLORS[color].dot} ${
            color === value ? "ring-foreground ring-offset-popover ring-2 ring-offset-1" : ""
          }`}
        />
      ))}
    </div>
  );
}
