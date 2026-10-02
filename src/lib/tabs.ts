export const TABS = ["Home", "Spending", "Net worth", "Mutual funds", "Stocks", "EPF", "Insurance", "Tax & income", "Settings"] as const;
export type Tab = (typeof TABS)[number];
