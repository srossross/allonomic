import type { KeyboardEvent } from "react";

export function activateOnKey(onActivate: () => void) {
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onActivate();
  };
}
