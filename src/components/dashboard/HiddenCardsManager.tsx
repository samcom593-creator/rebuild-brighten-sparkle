import { Eye } from "lucide-react";
import { useHiddenCards } from "@/hooks/useHiddenCards";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HiddenCardsManagerProps {
  /** All known card keys on the current page, mapped to display labels. */
  catalog: Record<string, string>;
}

/**
 * Lets the user restore cards they've hidden on the current page.
 * Renders nothing if the user hasn't hidden anything from `catalog`.
 */
export function HiddenCardsManager({ catalog }: HiddenCardsManagerProps) {
  const { isHidden, show } = useHiddenCards();

  const hiddenOnPage = Object.entries(catalog).filter(([key]) => isHidden(key));
  if (hiddenOnPage.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          {hiddenOnPage.length} hidden
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Restore hidden cards</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hiddenOnPage.map(([key, label]) => (
          <DropdownMenuItem key={key} onClick={() => show(key)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
