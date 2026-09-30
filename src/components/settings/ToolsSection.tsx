import { Checkbox } from "@/components/ui/checkbox";
import { AVAILABLE_TOOLS } from "@/types";
import { SectionHeader, SettingRow } from "./SettingRow";
import { sourceOf, withEntry, withKey, type SectionProperties } from "./layerEdit";

export function ToolsSection({ scoped, scope, update }: SectionProperties) {
  const layer = scoped.layers[scope];
  const { enabledTools } = scoped.inherited[scope];
  const setTool = (name: string, isEnabled: boolean | undefined) => {
    const tools = withEntry(layer.tools ?? {}, name, isEnabled);
    update(withKey(layer, "tools", tools));
  };

  return (
    <>
      <SectionHeader>Tools</SectionHeader>
      <div className="divide-border/30 divide-y">
        {AVAILABLE_TOOLS.map(({ name }) => {
          const own = layer.tools?.[name];
          return (
            <SettingRow
              key={name}
              label={name}
              source={sourceOf(scoped, scope, (l) => l.tools?.[name])}
              isSet={own !== undefined}
              onReset={() => setTool(name, undefined)}
            >
              <Checkbox
                checked={own ?? enabledTools.includes(name)}
                onCheckedChange={(checked) => setTool(name, checked)}
              />
            </SettingRow>
          );
        })}
      </div>
    </>
  );
}
