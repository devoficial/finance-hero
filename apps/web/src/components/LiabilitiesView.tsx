import type { LiabilitiesResponse } from "@finance-hero/contracts";

interface LiabilitiesViewProps {
  data?: LiabilitiesResponse;
  loading: boolean;
  money: (paise: number) => string;
}

function productName(productType: string) {
  return productType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function LiabilitiesView({ data, loading, money }: LiabilitiesViewProps) {
  if (loading || !data) {
    return <section className="panel loading-panel">Reading the liability register...</section>;
  }

  return (
    <>
      <section className="liability-metrics" aria-label="Liability summary">
        <article className="metric-card warning">
          <span>Current principal</span>
          <strong>{money(data.totalPrincipalPaise)}</strong>
          <small>{data.activeCount} active facilities</small>
        </article>
        <article className="metric-card">
          <span>Total monthly EMI</span>
          <strong>{money(data.totalEmiPaise)}</strong>
          <small>Committed monthly outflow</small>
        </article>
        <article className="metric-card">
          <span>Original obligations</span>
          <strong>{money(data.totalOriginalPaise)}</strong>
          <small>Includes cleared two-wheeler loan</small>
        </article>
        <article className="metric-card positive">
          <span>Cleared accounts</span>
          <strong>{data.clearedCount}</strong>
          <small>Retained for repayment history</small>
        </article>
      </section>

      <article className="panel liabilities-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIABILITY SHEET / SNOWBALL ORDER</p>
            <h2>Loans and credit cards</h2>
          </div>
          <span className="live-pill">{data.liabilities.length} ACCOUNTS</span>
        </div>

        <div className="table-scroll">
          <table className="liabilities-table">
            <thead>
              <tr>
                <th>Liability</th>
                <th>Type</th>
                <th>Original amount</th>
                <th>Current principal</th>
                <th>Repaid</th>
                <th>EMI</th>
                <th>Rate</th>
                <th>Status</th>
                <th>Snowball</th>
              </tr>
            </thead>
            <tbody>
              {data.liabilities.map((liability) => {
                const paidPercentage =
                  liability.originalAmountPaise > 0
                    ? Math.min(100, Math.round((liability.paidPaise / liability.originalAmountPaise) * 100))
                    : 0;
                return (
                  <tr className={liability.status} key={liability.id}>
                    <td>
                      <strong>{liability.name}</strong>
                      <div className="liability-progress">
                        <i style={{ width: `${paidPercentage}%` }} />
                      </div>
                    </td>
                    <td>{productName(liability.productType)}</td>
                    <td>{money(liability.originalAmountPaise)}</td>
                    <td className="principal-cell">{money(liability.currentPrincipalPaise)}</td>
                    <td>{money(liability.paidPaise)}</td>
                    <td>{money(liability.emiPaise)}</td>
                    <td>{liability.annualRateBps == null ? "—" : `${(liability.annualRateBps / 100).toFixed(2)}%`}</td>
                    <td>
                      <span className={`status-pill ${liability.status}`}>{liability.status}</span>
                    </td>
                    <td>
                      {liability.snowballRank == null ? (
                        "—"
                      ) : (
                        <span className="rank-pill">#{liability.snowballRank}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}
