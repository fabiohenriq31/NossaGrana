import { DropdownMenu as D } from "radix-ui";
import type { ReactNode } from "react";
export function Dropdown({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: { label: string; action: () => void }[];
}) {
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content className="dropdown" sideOffset={8}>
          {items.map((i) => (
            <D.Item key={i.label} onSelect={i.action}>
              {i.label}
            </D.Item>
          ))}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
