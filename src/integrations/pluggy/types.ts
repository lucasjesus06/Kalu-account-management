export type PluggyAccount = {
  id: string;
  type: string;
  subtype?: string | null;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  balance: number;
  currencyCode?: string | null;
  creditData?: {
    brand?: string | null;
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceDueDate?: string | null;
  } | null;
};

export type PluggyBill = {
  id: string;
  dueDate: string;
  totalAmount: number;
  totalAmountCurrencyCode?: string | null;
  minimumPaymentAmount?: number | null;
};

export type PluggyTransaction = {
  id: string;
  accountId?: string | null;
  date: string;
  description: string;
  amount: number;
  amountInAccountCurrency?: number | null;
  currencyCode?: string | null;
  type?: string | null;
  status?: string | null;
  category?: string | null;
  creditCardMetadata?: {
    billId?: string | null;
    installmentNumber?: number | null;
    totalInstallments?: number | null;
  } | null;
};

export type PluggyPage<T> = {
  results: T[];
  total?: number;
  totalPages?: number;
  page?: number;
};

export type PluggyCursorPage<T> = {
  results: T[];
  next?: string | null;
};
