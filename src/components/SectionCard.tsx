import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  /** Muted text beside the title, e.g. a month. */
  subtitle?: ReactNode;
  /** Longer explanatory line under the title. */
  description?: ReactNode;
  /** Right-aligned slot: a link, toggle, etc. */
  action?: ReactNode;
  /** Pad the body. Turn off for full-bleed lists. */
  padded?: boolean;
  className?: string;
  /** Classes for the card body (spacing between its children, etc.). */
  bodyClassName?: string;
  children: ReactNode;
}

/** Dashboard section: a small title row above a soft bordered card. */
export default function SectionCard({ title, subtitle, description, action, padded = true, className, bodyClassName, children }: Props) {
  return (
    <section className={cn("w-full", className)}>
      <div className="flex items-start justify-between gap-3 pb-2">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {subtitle && <span className="text-xs text-muted-foreground/70">{subtitle}</span>}
          </div>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className={cn("rounded-xl border border-border/60 bg-card", padded && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
