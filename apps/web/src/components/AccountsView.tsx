import type {
  CreateFinancialAccountRequest,
  FinancialAccount,
  FinancialAccountsResponse,
  UpdateFinancialAccountRequest,
} from "@finance-hero/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { createFinancialAccount, updateFinancialAccount } from "../lib/api";

interface AccountsViewProps {
  data?: FinancialAccountsResponse;
  loading: boolean;
  money: (paise: number) => string;
  onOpenLedger: () => void;
  onOpenLiabilities: () => void;
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

export function AccountsView({ data, loading, money, onOpenLedger, onOpenLiabilities }: AccountsViewProps) {
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

  return (
    <section className="accounts-workspace">
      <div className="accounts-brief">
        <div>
          <p className="eyebrow">ACCOUNT CONTROL / ONE SOURCE OF TRUTH</p>
          <h2>Every balance has an owner.</h2>
          <p>
            Edit savings and wallet valuations here. Transaction accounts follow the ledger; loans follow the liability
            register.
          </p>
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
          <strong className="money-value">{money(data.totalLiabilityBalancePaise)}</strong>
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
          <strong>Savings, investments and wallets</strong>
          <small>Edit the current balance here; it becomes a dated valuation.</small>
        </article>
        <article>
          <span>LEDGER CALCULATED</span>
          <strong>Bank and cash transaction accounts</strong>
          <small>Post or reconcile transactions so the audit trail remains intact.</small>
          <button onClick={onOpenLedger} type="button">
            Open ledger
          </button>
        </article>
        <article>
          <span>LIABILITY CALCULATED</span>
          <strong>Loans and credit cards</strong>
          <small>Edit principal or clear the facility in the liability register.</small>
          <button onClick={onOpenLiabilities} type="button">
            Open liabilities
          </button>
        </article>
      </section>

      <div className="accounts-register panel">
        <div className="accounts-register-head">
          <div>
            <p className="eyebrow">ACCOUNT REGISTER</p>
            <h2>Connected financial positions</h2>
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
              {item}
            </button>
          ))}
        </fieldset>

        <div className="accounts-table" ref={tableRef}>
          <div className="accounts-table-header">
            <span>ACCOUNT</span>
            <span>CLASS</span>
            <span>INSTITUTION</span>
            <span>BALANCE</span>
            <span>ACTIVITY</span>
            <span>ACTION</span>
          </div>
          {filteredAccounts.map((account) => (
            <article className={!account.isActive ? "inactive" : ""} key={account.id}>
              <div>
                <strong>{account.name}</strong>
                <small>{accountTypeLabel(account)}</small>
              </div>
              <div>
                <span className={`account-class ${account.accountClass}`}>{account.accountClass}</span>
                <small>{account.managedBy === "ledger" ? "Unified ledger" : `Managed in ${account.managedBy}`}</small>
              </div>
              <span>{account.institution || "Independent"}</span>
              <strong
                className={`account-balance money-value ${
                  account.accountClass === "liability" && account.balancePaise > 0 ? "negative" : ""
                }`}
              >
                {money(account.balancePaise)}
              </strong>
              <span>
                {account.transactionCount} entries
                <small>{account.isActive ? "Active" : "Archived"}</small>
              </span>
              <button className="table-action" onClick={() => openEditForm(account)} type="button">
                Edit
              </button>
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
                  ? "This balance is calculated from the unified ledger. Use transactions or reconciliation to change it."
                  : editing
                    ? "Saving the balance creates a fresh dated valuation while preserving prior ledger history."
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
                    <strong>{editing.managedBy === "liability" ? "Liability register" : "Unified ledger"}</strong>
                    <button
                      onClick={editing.managedBy === "liability" ? onOpenLiabilities : onOpenLedger}
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
    </section>
  );
}
