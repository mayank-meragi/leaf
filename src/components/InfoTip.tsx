import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { METRICS, type MetricId } from "@/lib/metricInfo";

/** A small (i) button that explains a metric: what it means, what a good range looks like, and what to watch out for. */
export default function InfoTip({ id }: { id: MetricId }) {
  const m = METRICS[id];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${m.title}`}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2.5 text-sm">
        <h4 className="font-semibold">{m.title}</h4>
        <Part label="What it means">{m.means}</Part>
        <Part label="Good range">{m.good}</Part>
        {m.caution && <Part label="Watch out">{m.caution}</Part>}
      </PopoverContent>
    </Popover>
  );
}

function Part({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="leading-snug">{children}</p>
    </div>
  );
}
