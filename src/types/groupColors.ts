export const GROUP_COLORS = {
  blue: { dot: "bg-blue-500", text: "text-blue-500", ring: "ring-blue-500" },
  green: { dot: "bg-green-500", text: "text-green-500", ring: "ring-green-500" },
  amber: { dot: "bg-amber-500", text: "text-amber-500", ring: "ring-amber-500" },
  red: { dot: "bg-red-500", text: "text-red-500", ring: "ring-red-500" },
  purple: { dot: "bg-purple-500", text: "text-purple-500", ring: "ring-purple-500" },
  pink: { dot: "bg-pink-500", text: "text-pink-500", ring: "ring-pink-500" },
  teal: { dot: "bg-teal-500", text: "text-teal-500", ring: "ring-teal-500" },
  slate: { dot: "bg-slate-500", text: "text-slate-500", ring: "ring-slate-500" },
} as const;

export type GroupColor = keyof typeof GROUP_COLORS;

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && Object.hasOwn(GROUP_COLORS, value);
}

export const GROUP_COLOR_KEYS: GroupColor[] = Object.keys(GROUP_COLORS).filter(isGroupColor);
