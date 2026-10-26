/**
 * Documentos del modelo nuevo tal como viven en Firestore bajo users/{uid}/…
 * (ver tools/migrate/salary_migrate/transform.py y la especificación, sección 5).
 * Solo los campos que el motor necesita.
 */
import type { IsoDate, Month } from "./months";

export interface Settings {
  startMonth: Month;           // mismo significado que min_managed_month de la app vieja
  mainAccountId: string | null;
  /** D3: mes desde el que los reembolsos de gastos propios se controlan en la app (antes, saldados fuera). */
  ownExpensesFrom?: Month;
}

export interface AccountDoc { name?: string; initialBalance: number; archived?: boolean }
/** `isFuel`: pide km y precio por litro al apuntar (sin marca, lo es si ya tiene repostajes). Sin efecto en cálculos. */
export interface CategoryDoc { name?: string; archived?: boolean; isFuel?: boolean }

export interface Deduction { name: string | null; rate: number; appliesToExtras: boolean }
export interface SalaryRevision { from: Month; gross: number; paidFrom?: Month }
export interface Overtime { id: string; month: Month; gross: number }
export interface SalaryDoc {
  name?: string;
  /** A (18-oct-2026): deducciones vigentes a partir de un mes. Sin ellas, `deductions` vale para todos. */
  deductionRevisions?: { from: Month; deductions: Deduction[] }[];
  grossMonthly: number;
  start: IsoDate;
  end: IsoDate | null;
  accountId: string | null;
  deductions: Deduction[];
  revisions: SalaryRevision[];
  overtimes: Overtime[];
}

/** B (18-oct-2026): `isOwnExpense` también puede cambiar a partir de un mes. */
export interface FixedRevision { from: Month; amount?: number; accountId?: string; isOwnExpense?: boolean; legacyBankId?: string }
export interface FixedPayment { status: "paid" | "unpaid"; amount: number | null; legacyId?: string }
export interface FixedExpenseDoc {
  name?: string;
  amount: number;
  start: IsoDate;
  end: IsoDate | null;
  accountId: string | null;
  isOwnExpense: boolean;
  /** Etiqueta. Con countsInBudget, el gasto fijo cuenta dentro del budget de esa categoría (misma cuenta). */
  categoryId?: string | null;
  countsInBudget?: boolean;
  revisions: FixedRevision[];
  payments: Record<Month, FixedPayment>;
}

export interface BudgetDoc {
  categoryId: string | null; accountId: string | null; amount: number; start: IsoDate; end: IsoDate | null;
  /** Nuevo importe a partir de un mes (B3). */
  revisions?: { from: Month; amount: number }[];
}

export interface CardInfo { cardId: string; chargeMonth: Month | null; reserveIn: "purchase" | "charge" }
export interface MovementDoc {
  type: "expense" | "income" | "transfer";
  date: IsoDate;
  amount: number;
  description?: string;
  categoryId?: string | null;
  accountId: string | null;
  toAccountId?: string | null;
  card?: CardInfo;
  transferKind?: "normal" | "loan" | "loanRepayment" | "ownExpenseRefund";
  loan?: { status: "pending" | "paid"; outstanding: number };
  /** Repostaje: km hechos desde el anterior y precio por litro (como la app vieja). Sin efecto en cálculos. */
  fuel?: { km: number; pricePerLiter: number };
}

export interface CardDoc { name?: string; accountId: string }
export interface CardSettlementDoc {
  cardId: string; accountId: string; chargeMonth: Month; date: IsoDate; amount: number;
  legacy?: { id?: string };
}

export interface Docs {
  accounts: Record<string, AccountDoc>;
  categories: Record<string, CategoryDoc>;
  salaries: Record<string, SalaryDoc>;
  fixedExpenses: Record<string, FixedExpenseDoc>;
  budgets: Record<string, BudgetDoc>;
  movements: Record<string, MovementDoc>;
  cards: Record<string, CardDoc>;
  cardSettlements: Record<string, CardSettlementDoc>;
}

export interface Dataset {
  profile: { settings: Settings };
  docs: Docs;
}
