import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  value?: string;
  categories: string[];
  onChange: (category: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Searchable category picker; typing a name that doesn't exist offers to create it. */
export default function CategoryCombobox({ value, categories, onChange, disabled, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const trimmed = search.trim();
  const exists = categories.some((c) => c.toLowerCase() === trimmed.toLowerCase());

  const pick = (category: string) => {
    setOpen(false);
    setSearch("");
    if (category !== value) onChange(category);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between gap-1 font-normal text-muted-foreground", className)}
        >
          <span className="truncate">{value ?? "Uncategorised"}</span>
          <ChevronsUpDownIcon className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search or create…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              {categories.map((c) => (
                <CommandItem key={c} value={c} onSelect={() => pick(c)}>
                  <CheckIcon className={cn("size-4", c === value ? "opacity-100" : "opacity-0")} />
                  {c}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmed && !exists && (
              <CommandGroup forceMount>
                {/* forceMount + a value that always matches keeps this visible while filtering. */}
                <CommandItem forceMount value={`__create__${trimmed}`} onSelect={() => pick(trimmed)}>
                  <PlusIcon className="size-4" />
                  Create “{trimmed}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
