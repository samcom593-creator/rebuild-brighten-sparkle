import { useSortable } from "@dnd-kit/sortable";
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

  // Only apply transform when actively dragging to prevent continuous animations
  const style = isDragging && transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
    zIndex: 50,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-none",
        isDragging && "opacity-50 cursor-grabbing",
        !isDragging && !disabled && "cursor-grab"
      )}
    >
      {children}
    </div>
  );
}
