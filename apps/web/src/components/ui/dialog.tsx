import { Dialog as Primitive } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content className="dialog-content">
          <Primitive.Title className="dialog-title">{title}</Primitive.Title>
          <Primitive.Description
            className={description ? "dialog-description" : "sr-only"}
          >
            {description || "Preencha as informações e salve as alterações."}
          </Primitive.Description>
          <Primitive.Close className="dialog-close" aria-label="Fechar">
            <X size={20} />
          </Primitive.Close>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
