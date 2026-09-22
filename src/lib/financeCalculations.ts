export type FinanceTransaction = {
  id: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  pending: boolean;
  category?: string | null;
  category_path?: unknown;
};

const transferPattern = /transfer|credit card payment|card payment|payment thank/i;

export function isInternalTransfer(transaction: FinanceTransaction) {
  const categories = Array.isArray(transaction.category_path)
    ? transaction.category_path.map(String).join(" ")
    : "";
  return (
    /transfer|credit card payment/i.test(String(transaction.category ?? "")) ||
    /transfer|credit card payment/i.test(categories) ||
    transferPattern.test(transaction.name)
  );
}

export function calculateObservedCashflow(
  transactions: FinanceTransaction[],
  months = 3,
) {
  const eligible = transactions.filter(
    (transaction) => !transaction.pending && !isInternalTransfer(transaction),
  );
  const expenses = eligible
    .filter((transaction) => transaction.amount > 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const income = eligible
    .filter((transaction) => transaction.amount < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  return {
    expenses,
    income,
    monthlyExpenses: expenses / Math.max(1, months),
    monthlyIncome: income / Math.max(1, months),
    eligibleTransactionIds: eligible.map((transaction) => transaction.id),
    excludedTransactionIds: transactions
      .filter((transaction) => !eligible.includes(transaction))
      .map((transaction) => transaction.id),
  };
}
