import type {
  CreateFinancialAccountRequest,
  FinancialAccount,
  FinancialAccountsResponse,
  ProjectSummaryResponse,
  UpdateFinancialAccountRequest,
  WealthResponse,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { createFinancialAccount, deleteFinancialAccount, updateFinancialAccount } from "../lib/api";
import { AccountPurposeTrackers } from "./AccountPurposeTrackers";

interface AccountsViewProps {
  data?: FinancialAccountsResponse;
  loading: boolean;
  money: (paise: number) => string;
  wealth?: WealthResponse;
  project?: ProjectSummaryResponse;
  onOpenExpenses: () => void;
  onOpenGoals: () => void;
  onOpenLiabilities: () => void;
  onOpenProjects: () => void;
}

type AccountFilter = "all" | "asset" | "liability" | "inactive";
type AccountType = CreateFinancialAccountRequest["accountType"];

function rupeesToPaise(value: string): number | null {
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : null;
}

function accountTypeLabel(account: FinancialAccount): string {
  if (account.managedBy === "liability") {
    return account.accountType.replaceAll("_", " ");
  }
  if (account.restricted) {
    return "Restricted wallet";
  }
  return account.accountType.replaceAll("_", " ");
}

function balanceSourceLabel(account: FinancialAccount): string {
  if (account.id === "account-primary-bank") return "Monthly bank reconciliation";
  if (account.managedBy === "ledger") return "Recorded transactions";
  if (account.managedBy === "liability") return "Liability register";
  return "Direct valuation";
}

function allocationPolicyLabel(policy: WealthResponse["assets"][number]["allocationPolicy"]): string {
  const labels = {
    emergency_only: "Emergency only",
    construction_only: "Construction only",
    retirement: "Retirement only",
    long_term_wealth: "Long-term wealth",
    short_term: "Short-term goals",
    flexible: "Flexible",
    none: "Not allocatable",
  } as const;
  return labels[policy];
}

export function AccountsView({
  data,
  loading,
  money,
  wealth,
  project,
  onOpenExpenses,
  onOpenGoals,
  onOpenLiabilities,
  onOpenProjects,
}: AccountsViewProps) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("bank");
  const [institution, setInstitution] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [balance, setBalance] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<FinancialAccount | null>(null);

  const refreshAccounts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["reference-data"] }),
      queryClient.invalidateQueries({ queryKey: ["wealth"] }),
      queryClient.invalidateQueries({ queryKey: ["liabilities"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  const accountMutation = useMutation({
    mutationFn: async (
      request:
        | { mode: "create"; input: CreateFinancialAccountRequest }
        | { mode: "update"; id: string; input: UpdateFinancialAccountRequest },
    ) =>
      request.mode === "create"
        ? createFinancialAccount(request.input)
        : updateFinancialAccount(request.id, request.input),
    onSuccess: async () => {
      setShowForm(false);
      setEditing(null);
      setFormError(null);
      await refreshAccounts();
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "The account could not be saved.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFinancialAccount,
    onSuccess: async () => {
      setAccountToDelete(null);
      await refreshAccounts();
    },
  });

  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-IN");
    return (data?.accounts ?? []).filter((account) => {
      const filterMatches =
        filter === "all" ||
        (filter === "inactive" ? !account.isActive : account.accountClass === filter && account.isActive);
      const searchMatches =
        !needle ||
        account.name.toLocaleLowerCase("en-IN").includes(needle) ||
        account.institution?.toLocaleLowerCase("en-IN").includes(needle) ||
        account.accountType.toLocaleLowerCase("en-IN").includes(needle);
      return filterMatches && searchMatches;
    });
  }, [data?.accounts, filter, search]);
  const wealthByAccountId = useMemo(
    () => new Map((wealth?.assets ?? []).map((asset) => [asset.accountId, asset])),
    [wealth?.assets],
  );

  if (loading || !data) {
    return <section className="panel loading-panel">Reading the account registry...</section>;
  }

  function openCreateForm() {
    setEditing(null);
    setName("");
    setAccountType("bank");
    setInstitution("");
    setOpeningBalance("");
    setBalance("");
    setRestricted(false);
    setIsActive(true);
    setFormError(null);
    setShowForm(true);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function openEditForm(account: FinancialAccount) {
    setEditing(account);
    setName(account.name);
    setInstitution(account.institution ?? "");
    setBalance(String(account.balancePaise / 100));
    setIsActive(account.isActive);
    setFormError(null);
    setShowForm(true);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setFormError("Enter an account name.");
      return;
    }
    setFormError(null);
    if (editing) {
      const balancePaise = editing.managedBy === "wealth" ? rupeesToPaise(balance) : null;
      if (editing.managedBy === "wealth" && balancePaise == null) {
        setFormError("Enter a valid non-negative current balance.");
        return;
      }
      accountMutation.mutate({
        mode: "update",
        id: editing.id,
        input: {
          name: name.trim(),
          institution: institution.trim() || null,
          isActive,
          ...(balancePaise == null ? {} : { balancePaise }),
        },
      });
      return;
    }

    const openingBalancePaise = rupeesToPaise(openingBalance);
    if (openingBalancePaise == null) {
      setFormError("Enter a valid non-negative opening balance.");
      return;
    }
    accountMutation.mutate({
      mode: "create",
      input: {
        name: name.trim(),
        accountType,
        institution: institution.trim() || null,
        openingBalancePaise,
        restricted,
      },
    });
  }

  const activeAssets = data.accounts.filter((account) => account.accountClass === "asset" && account.isActive).length;
  const activeLiabilities = data.accounts.filter(
    (account) => account.accountClass === "liability" && account.isActive,
  ).length;
  const inactiveAccounts = data.accounts.filter((account) => !account.isActive).length;
  const filterCounts: Record<AccountFilter, number> = {
    all: data.accounts.length,
    asset: activeAssets,
    liability: activeLiabilities,
    inactive: inactiveAccounts,
  };

  return (
    <section className="accounts-workspace">
      <div className="accounts-brief">
        <div>
          <p className="eyebrow">ACCOUNT CONTROL / ONE SOURCE OF TRUTH</p>
          <h2>Accounts at a glance.</h2>
          <p>Direct valuations, transaction balances and liabilities—without duplicate totals.</p>
        </div>
        <div className="accounts-brief-actions">
          <button className="ghost-button" onClick={onOpenLiabilities} type="button">
            Manage loans
          </button>
          <button className="add-button" onClick={openCreateForm} type="button">
            + Add account
          </button>
        </div>
      </div>

      <div className="accounts-kpis">
        <article>
          <span>ASSET BALANCES</span>
          <strong className="money-value">{money(data.totalAssetBalancePaise)}</strong>
          <small>{activeAssets} active asset accounts</small>
        </article>
        <article>
          <span>LIABILITY BALANCES</span>
          <strong className="money-value liability-value">{money(data.totalLiabilityBalancePaise)}</strong>
          <small>{activeLiabilities} linked liability accounts</small>
        </article>
        <article>
          <span>ACCOUNT POSITION</span>
          <strong
            className={`money-value ${
              data.totalAssetBalancePaise - data.totalLiabilityBalancePaise < 0 ? "negative" : ""
            }`}
          >
            {money(data.totalAssetBalancePaise - data.totalLiabilityBalancePaise)}
          </strong>
          <small>Tracked assets minus bank and card principal</small>
        </article>
        <article>
          <span>ARCHIVED</span>
          <strong className="money-value">{inactiveAccounts}</strong>
          <small>Kept for complete history</small>
        </article>
      </div>

      <section className="account-source-guide" aria-label="How account balances are edited">
        <article>
          <span>DIRECT VALUATION</span>
          <strong>Savings and wallets</strong>
          <small>Edit balance here</small>
        </article>
        <article>
          <span>TRANSACTION CALCULATED</span>
          <strong>Bank and cash</strong>
          <small>Updated by activity</small>
          <button onClick={onOpenExpenses} type="button">
            Open expenses
          </button>
        </article>
        <article>
          <span>LIABILITY CALCULATED</span>
          <strong>Loans and cards</strong>
          <small>Updated in liabilities</small>
          <button onClick={onOpenLiabilities} type="button">
            Open liabilities
          </button>
        </article>
      </section>

      <AccountPurposeTrackers
        accounts={data.accounts}
        money={money}
        onOpenGoals={onOpenGoals}
        onOpenProjects={onOpenProjects}
        project={project}
        wealth={wealth}
      />

      <div className="accounts-register panel">
        <div className="accounts-register-head">
          <div>
            <p className="eyebrow">ACCOUNT REGISTER</p>
            <h2>Connected financial positions</h2>
            <small>{filteredAccounts.length} accounts shown</small>
          </div>
          <label className="accounts-search">
            <span>SEARCH</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, institution or type"
              type="search"
              value={search}
            />
          </label>
        </div>

        <fieldset className="accounts-filters" aria-label="Account filters">
          {(["all", "asset", "liability", "inactive"] as const).map((item) => (
            <button
              className={filter === item ? "active" : ""}
              key={item}
              onClick={() => {
                setFilter(item);
                if (tableRef.current) {
                  tableRef.current.scrollLeft = 0;
                }
              }}
              type="button"
            >
              <span>{item}</span>
              <b>{filterCounts[item]}</b>
            </button>
          ))}
        </fieldset>

        <div className="accounts-card-grid" ref={tableRef}>
          {filteredAccounts.map((account) => (
            <article
              className={`account-card ${account.accountClass} ${!account.isActive ? "inactive" : ""}`}
              key={account.id}
            >
              <div className="account-card-heading">
                <div className="account-name-line">
                  <strong>{account.name}</strong>
                  <span className={`account-class ${account.accountClass}`}>{account.accountClass}</span>
                </div>
                <small>{accountTypeLabel(account)}</small>
              </div>
              <strong
                className={`account-balance money-value ${
                  account.accountClass === "liability" && account.balancePaise > 0
                    ? "negative liability-value"
                    : account.balancePaise < 0
                      ? "negative"
                      : ""
                }`}
              >
                {money(account.balancePaise)}
              </strong>
              <div className="account-card-meta">
                <span>
                  <small>OWNER</small>
                  <strong>{account.institution || "Independent"}</strong>
                </span>
                <span>
                  <small>SOURCE</small>
                  <strong>{balanceSourceLabel(account)}</strong>
                </span>
                <span>
                  <small>ACTIVITY</small>
                  <strong>
                    {account.transactionCount} {account.transactionCount === 1 ? "entry" : "entries"}
                  </strong>
                </span>
                {wealthByAccountId.get(account.id) && (
                  <span>
                    <small>GOAL RULE</small>
                    <strong>
                      {allocationPolicyLabel(wealthByAccountId.get(account.id)?.allocationPolicy ?? "none")}
                    </strong>
                  </span>
                )}
              </div>
              <div className="account-row-actions">
                <button className="table-action" onClick={() => openEditForm(account)} type="button">
                  Edit
                </button>
                <button className="account-remove-action" onClick={() => setAccountToDelete(account)} type="button">
                  Remove
                </button>
              </div>
            </article>
          ))}
          {filteredAccounts.length === 0 && <p className="accounts-empty">No accounts match this filter.</p>}
        </div>
      </div>

      {showForm && (
        <div className="account-form-shell panel" ref={formRef}>
          <div>
            <p className="eyebrow">{editing ? "EDIT ACCOUNT" : "NEW ASSET ACCOUNT"}</p>
            <h2>{editing ? editing.name : "Connect another money position"}</h2>
            <p>
              {editing?.managedBy === "liability"
                ? "The name is shared with the liability register. Clear active debt there before archiving it."
                : editing?.managedBy === "ledger"
                  ? "This balance is calculated from recorded transactions. Use expenses or reconciliation to change it."
                  : editing
                    ? "Saving the balance creates a fresh dated valuation while preserving prior transaction history."
                    : "Opening balance becomes the starting valuation; later transactions update it automatically."}
            </p>
          </div>
          <form className="account-form" onSubmit={submitAccount}>
            <label>
              Account name
              <input maxLength={160} onChange={(event) => setName(event.target.value)} required value={name} />
            </label>
            <label>
              Institution
              <input
                maxLength={160}
                onChange={(event) => setInstitution(event.target.value)}
                placeholder="Bank, card issuer or provider"
                value={institution}
              />
            </label>
            {!editing && (
              <>
                <label>
                  Account type
                  <select onChange={(event) => setAccountType(event.target.value as AccountType)} value={accountType}>
                    <option value="bank">Bank account</option>
                    <option value="cash">Cash</option>
                    <option value="savings">Savings</option>
                    <option value="investment">Investment</option>
                    <option value="wallet">Wallet</option>
                    <option value="other">Other asset</option>
                  </select>
                </label>
                <label>
                  Opening balance (INR)
                  <input
                    min="0"
                    onChange={(event) => setOpeningBalance(event.target.value)}
                    placeholder="0"
                    required
                    step="0.01"
                    type="number"
                    value={openingBalance}
                  />
                </label>
                <label className="account-checkbox">
                  <input
                    checked={restricted}
                    onChange={(event) => setRestricted(event.target.checked)}
                    type="checkbox"
                  />
                  Restricted spending wallet
                </label>
              </>
            )}
            {editing && (
              <>
                {editing.managedBy === "wealth" ? (
                  <label>
                    Current balance (INR)
                    <input
                      min="0"
                      onChange={(event) => setBalance(event.target.value)}
                      required
                      step="0.01"
                      type="number"
                      value={balance}
                    />
                  </label>
                ) : (
                  <div className="account-balance-owner">
                    <span>BALANCE SOURCE</span>
                    <strong>{editing.managedBy === "liability" ? "Liability register" : "Financial records"}</strong>
                    <button
                      onClick={editing.managedBy === "liability" ? onOpenLiabilities : onOpenExpenses}
                      type="button"
                    >
                      Edit at source
                    </button>
                  </div>
                )}
                <label className="account-checkbox">
                  <input checked={isActive} onChange={(event) => setIsActive(event.target.checked)} type="checkbox" />
                  Active account
                </label>
              </>
            )}
            {formError && <p className="form-error">{formError}</p>}
            <div className="account-form-actions">
              <button className="add-button" disabled={accountMutation.isPending} type="submit">
                {accountMutation.isPending ? "Saving..." : editing ? "Save account" : "Create account"}
              </button>
              <button className="ghost-button" onClick={() => setShowForm(false)} type="button">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {accountToDelete && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" className="wealth-modal account-delete-modal" role="dialog">
            <div className="modal-title">
              <div>
                <p className="eyebrow">DELETE ACCOUNT</p>
                <h2>Remove {accountToDelete.name}?</h2>
              </div>
            </div>
            <p>
              Accounts with no history are deleted permanently. Accounts with financial history are archived so past
              statements and reports remain correct. Transfer or clear any remaining balance first.
            </p>
            {deleteMutation.error && <p className="form-error">{deleteMutation.error.message}</p>}
            <div className="modal-actions">
              <button disabled={deleteMutation.isPending} onClick={() => setAccountToDelete(null)} type="button">
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(accountToDelete.id)}
                type="button"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
