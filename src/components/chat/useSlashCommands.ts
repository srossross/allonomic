import { useState } from "react";

export interface SlashCommand {
  name: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [{ name: "/settings", description: "Open settings" }];

function matchSlashCommands(input: string): SlashCommand[] {
  return !input.startsWith("/") || /\s/.test(input)
    ? []
    : SLASH_COMMANDS.filter((c) => c.name.startsWith(input));
}

export function useSlashCommands(input: string, onSelect: (command: SlashCommand) => void) {
  const [index, setIndex] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const commands = isDismissed ? [] : matchSlashCommands(input);
  const selectedIndex = Math.min(index, commands.length - 1);

  const didHandleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const n = commands.length;
    if (n === 0) return false;
    switch (e.key) {
      case "ArrowDown": {
        setIndex((selectedIndex + 1) % n);
        break;
      }
      case "ArrowUp": {
        setIndex((selectedIndex - 1 + n) % n);
        break;
      }
      case "Tab":
      case "Enter": {
        if (e.shiftKey) return false;
        onSelect(commands[selectedIndex]);
        break;
      }
      case "Escape": {
        setIsDismissed(true);
        break;
      }
      default: {
        return false;
      }
    }
    e.preventDefault();
    return true;
  };

  return {
    commands,
    selectedIndex,
    setIndex,
    didHandleKey,
    resetDismissed: () => setIsDismissed(false),
  };
}
