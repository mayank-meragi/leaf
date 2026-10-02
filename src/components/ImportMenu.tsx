import { useRef, useState } from "react";
import { BookOpenIcon, FileUpIcon, LandmarkIcon, PieChartIcon, ReceiptIndianRupeeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ViewProps } from "@/App";
import ImportCas from "./ImportCas";
import ImportDocument, { type Opener } from "./ImportDocument";
import WhereToGet from "./WhereToGet";

/** The one place to bring documents in: mutual fund statements, or any other document Leaf can read. */
export default function ImportMenu(props: ViewProps) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const doc = useRef<Opener>(null);
  const cas = useRef<Opener>(null);
  const bank = useRef<Opener>(null);

  const pick = (o: React.RefObject<Opener | null>) => {
    setOpen(false);
    o.current?.open();
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline">
            <FileUpIcon />
            Import
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          <Item icon={PieChartIcon} title="Mutual fund statement" hint="CAMS / KFintech CAS PDF or MF Central XLSX" onClick={() => pick(cas)} />
          <Item icon={ReceiptIndianRupeeIcon} title="Bank statement" hint="HDFC, Axis, … account or credit card statement (PDF, XLSX, CSV)" onClick={() => pick(bank)} />
          <Item icon={LandmarkIcon} title="Other document" hint="Payslip, Form 16, EPF / NPS / PPF, FD, loan, insurance" onClick={() => pick(doc)} />
          <div className="my-1 border-t" />
          <Item
            icon={BookOpenIcon}
            title="Where do I find these?"
            onClick={() => {
              setOpen(false);
              setHelp(true);
            }}
          />
        </PopoverContent>
      </Popover>
      <ImportCas {...props} ref={cas} />
      <ImportDocument {...props} ref={doc} />
      <ImportDocument {...props} mode="statement" ref={bank} />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Where to get your documents</DialogTitle>
            <DialogDescription>Download the file, then use Import.</DialogDescription>
          </DialogHeader>
          <WhereToGet />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Item({ icon: Icon, title, hint, onClick }: { icon: typeof FileUpIcon; title: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left hover:bg-accent">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
