export const TABS = ["Home", "Spending", "Net worth", "Mutual funds", "EPF", "Tax & income", "Settings"] as const;
export type Tab = (typeof TABS)[number];
