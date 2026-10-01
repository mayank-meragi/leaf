import { ExternalLinkIcon } from "lucide-react";
import SectionCard from "./SectionCard";

interface Source {
  what: string;
  auto?: string;
  how: string;
  link?: { href: string; label: string };
}

// Where each document lives when it doesn't arrive by email. Download it, then use "Import document".
const SOURCES: Source[] = [
  {
    what: "NPS",
    auto: "Automatic from Protean's emails: contributions, plus the monthly statement once its password is saved.",
    how: "Or download a Transaction Statement from the CRA site or the “NPS by Protean” app.",
    link: { href: "https://www.cra.nps-proteantech.in", label: "Protean CRA" },
  },
  {
    what: "EPF",
    how: "Log in with your UAN, pick your member ID and download the passbook PDF (one per employer). The UMANG app has the same passbook.",
    link: { href: "https://passbook.epfindia.gov.in", label: "EPFO passbook" },
  },
  {
    what: "PPF",
    how: "Your bank's net banking → PPF account → account statement (PDF). The closing balance is what Leaf needs.",
  },
  {
    what: "Stocks",
    how: "The NSDL/CDSL consolidated statement mailed monthly by the depository, or your broker's holdings statement (Groww: Reports → Holdings).",
  },
  {
    what: "Fixed deposits",
    how: "The FD advice / receipt from net banking, or add it by hand with “Add account”.",
  },
  {
    what: "Loans",
    how: "The lender's app or site → statement of account (shows principal outstanding). The yearly interest certificate is also accepted.",
  },
  {
    what: "Payslips & Form 16",
    how: "Your employer's payroll/HR portal. Form 16 is issued by June each year for the previous financial year.",
  },
  {
    what: "Tax (AIS / 26AS)",
    how: "Income-tax portal → log in → AIS, to cross-check TDS and interest/dividend income.",
    link: { href: "https://www.incometax.gov.in", label: "Income-tax portal" },
  },
  {
    what: "Insurance",
    how: "The policy schedule PDF from the insurer's app or welcome email (cover, premium, renewal date).",
  },
];

export default function WhereToGet({ only }: { only?: string[] }) {
  const list = only ? SOURCES.filter((s) => only.includes(s.what)) : SOURCES;
  return (
    <SectionCard title="Where to get these" description="For anything that doesn't come by email: download it, then “Import document”. Password-protected PDFs are fine.">
      <dl className="grid gap-x-6 gap-y-4 text-sm md:grid-cols-2">
        {list.map((s) => (
          <div key={s.what}>
            <dt className="font-medium">{s.what}</dt>
            <dd className="mt-0.5 text-muted-foreground">
              {s.auto && <span className="text-foreground">{s.auto} </span>}
              {s.how}
              {s.link && (
                <>
                  {" "}
                  <a href={s.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">
                    {s.link.label}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
