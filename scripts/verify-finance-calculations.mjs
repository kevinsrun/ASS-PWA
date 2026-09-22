import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const loaded = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(fs.readFileSync("src/lib/financeCalculations.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(loaded, loaded.exports);
const { calculateObservedCashflow } = loaded.exports;

const result = calculateObservedCashflow([
  { id: "income", name: "Payroll", amount: -2000, pending: false },
  { id: "refund", name: "Refund", amount: -100, pending: false },
  { id: "purchase", name: "Rent", amount: 1000, pending: false },
  { id: "pending", name: "Pending card", amount: 500, pending: true },
  { id: "transfer", name: "Online Transfer", amount: 900, pending: false, category: "TRANSFER_OUT" },
  { id: "card-payment", name: "Credit Card Payment", amount: 700, pending: false },
  { id: "duplicate", name: "Subscription", amount: 20, pending: false },
  { id: "duplicate-2", name: "Subscription", amount: 20, pending: false },
]);
assert.equal(result.expenses, 1040);
assert.equal(result.income, 2100);
assert.deepEqual(result.excludedTransactionIds.sort(), ["card-payment", "pending", "transfer"]);
console.log("Finance calculation fixtures passed: income, refunds, pending rows, transfers, card payments, and recurring transactions.");
