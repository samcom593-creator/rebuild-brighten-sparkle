import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface DraggableAgentCardProps {
  id: string;
  children: ReactNode;
  disabled?: boolean;
}

export function DraggableAgentCard({ id, children, disabled = false }: DraggableAgentCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-none",
        isDragging && "opacity-50 z-50 cursor-grabbing",
        !isDragging && !disabled && "cursor-grab"
      )}
    >
      {children}
    </div>
  );
}
