import type {
  DashboardResponse,
  FinancialAccountsResponse,
  LiabilitiesResponse,
  WealthResponse,
} from "@finance-hero/contracts";
import type { jsPDF as JsPdfDocument } from "jspdf";

export interface FinancialReportInput {
  generatedOn: Date;
  dashboard: DashboardResponse;
  accounts: FinancialAccountsResponse;
  liabilities: LiabilitiesResponse;
  wealth: WealthResponse;
}

interface ReportCell {
  value: string | number;
  danger?: boolean;
}

type ReportCellValue = string | number | ReportCell;
type ReportRow = ReportCellValue[];

const palette = {
  ink: [19, 36, 31] as const,
  muted: [90, 108, 102] as const,
  green: [20, 72, 60] as const,
  red: [181, 58, 42] as const,
  yellow: [246, 187, 61] as const,
  pale: [241, 238, 229] as const,
  line: [208, 207, 198] as const,
};

function formatPaise(paise: number) {
  const sign = paise < 0 ? "-" : "";
  return `${sign}Rs ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.abs(paise) / 100)}`;
}

function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

class PdfReport {
  private readonly margin = 14;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private cursorY = 14;

  constructor(private readonly doc: JsPdfDocument) {
    this.pageWidth = doc.internal.pageSize.getWidth();
    this.pageHeight = doc.internal.pageSize.getHeight();
  }

  private color(rgb: readonly [number, number, number]) {
    this.doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  }

  private ensureSpace(height: number) {
    if (this.cursorY + height <= this.pageHeight - 16) return;
    this.doc.addPage();
    this.cursorY = 18;
  }

  heading(title: string, subtitle: string) {
    this.doc.setFillColor(...palette.green);
    this.doc.rect(0, 0, this.pageWidth, 42, "F");
    this.doc.setFillColor(...palette.yellow);
    this.doc.rect(0, 0, 4, 42, "F");
    this.color([255, 255, 255]);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(24);
    this.doc.text(title, this.margin, 20);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
    this.doc.text(subtitle, this.margin, 30);
    this.doc.text("PRIVATE / GENERATED LOCALLY / INR", this.pageWidth - this.margin, 30, { align: "right" });
    this.cursorY = 52;
  }

  section(title: string, note?: string) {
    this.ensureSpace(19);
    this.doc.setDrawColor(...palette.green);
    this.doc.setLineWidth(1.1);
    this.doc.line(this.margin, this.cursorY, this.margin + 4, this.cursorY);
    this.color(palette.ink);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(14);
    this.doc.text(title, this.margin + 7, this.cursorY + 1);
    if (note) {
      this.color(palette.muted);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(7.5);
      this.doc.text(note, this.pageWidth - this.margin, this.cursorY + 1, { align: "right" });
    }
    this.cursorY += 8;
  }

  metrics(items: Array<{ label: string; value: string; danger?: boolean }>) {
    const gap = 2;
    const columns = Math.min(items.length, 4);
    const width = (this.pageWidth - this.margin * 2 - gap * (columns - 1)) / columns;
    const rows = Math.ceil(items.length / columns);
    this.ensureSpace(rows * 22 + 2);

    items.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = this.margin + column * (width + gap);
      const y = this.cursorY + row * 22;
      this.doc.setFillColor(...palette.pale);
      this.doc.setDrawColor(...palette.line);
      this.doc.rect(x, y, width, 19, "FD");
      this.color(palette.muted);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(6.5);
      this.doc.text(item.label.toUpperCase(), x + 3, y + 5);
      this.color(item.danger ? palette.red : palette.ink);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(11);
      this.doc.text(item.value, x + 3, y + 13);
    });
    this.cursorY += rows * 22 + 2;
  }

  table(headers: string[], rows: ReportRow[], widths: number[]) {
    const usableWidth = this.pageWidth - this.margin * 2;
    const scale = usableWidth / widths.reduce((sum, width) => sum + width, 0);
    const scaledWidths = widths.map((width) => width * scale);
    const scaledXPositions: number[] = [];
    let nextX = this.margin;
    for (const width of scaledWidths) {
      scaledXPositions.push(nextX);
      nextX += width;
    }

    const drawHeader = () => {
      this.ensureSpace(10);
      this.doc.setFillColor(219, 218, 210);
      this.doc.rect(this.margin, this.cursorY, usableWidth, 8, "F");
      this.color(palette.muted);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(6.2);
      headers.forEach((header, index) => {
        this.doc.text(header.toUpperCase(), (scaledXPositions[index] ?? this.margin) + 2, this.cursorY + 5);
      });
      this.cursorY += 8;
    };

    drawHeader();
    if (rows.length === 0) {
      this.color(palette.muted);
      this.doc.setFont("helvetica", "italic");
      this.doc.setFontSize(8);
      this.doc.text("No records", this.margin + 2, this.cursorY + 6);
      this.cursorY += 10;
      return;
    }

    for (const row of rows) {
      const cells = row.map((rawCell, index) => {
        const cell = typeof rawCell === "object" ? rawCell : { value: rawCell };
        const displayValue = typeof cell.value === "number" ? formatPaise(cell.value) : String(cell.value);
        return {
          ...cell,
          displayValue,
          lines: this.doc.splitTextToSize(displayValue, Math.max(8, (scaledWidths[index] ?? 20) - 4)) as string[],
        };
      });
      const rowHeight = Math.max(9, Math.max(...cells.map((cell) => cell.lines.length)) * 3.6 + 4);
      if (this.cursorY + rowHeight > this.pageHeight - 16) {
        this.doc.addPage();
        this.cursorY = 18;
        drawHeader();
      }
      this.doc.setDrawColor(...palette.line);
      this.doc.line(this.margin, this.cursorY + rowHeight, this.pageWidth - this.margin, this.cursorY + rowHeight);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(7.2);
      cells.forEach((cell, index) => {
        const numericValue = typeof cell.value === "number" ? cell.value : null;
        const numeric = numericValue !== null;
        this.color(cell.danger || (numericValue !== null && numericValue < 0) ? palette.red : palette.ink);
        const cellX = scaledXPositions[index] ?? this.margin;
        const cellWidth = scaledWidths[index] ?? 20;
        this.doc.text(cell.lines, numeric ? cellX + cellWidth - 2 : cellX + 2, this.cursorY + 5, {
          align: numeric ? "right" : "left",
        });
      });
      this.cursorY += rowHeight;
    }
    this.cursorY += 5;
  }

  paragraph(text: string) {
    const lines = this.doc.splitTextToSize(text, this.pageWidth - this.margin * 2) as string[];
    this.ensureSpace(lines.length * 4 + 5);
    this.color(palette.muted);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(7.5);
    this.doc.text(lines, this.margin, this.cursorY + 3);
    this.cursorY += lines.length * 4 + 5;
  }

  addFooters(generatedOn: Date) {
    const pages = this.doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      this.doc.setPage(page);
      this.doc.setDrawColor(...palette.line);
      this.doc.line(this.margin, this.pageHeight - 11, this.pageWidth - this.margin, this.pageHeight - 11);
      this.color(palette.muted);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(6.5);
      this.doc.text(`Finance Hero / generated ${formatDate(generatedOn)}`, this.margin, this.pageHeight - 6);
      this.doc.text(`Page ${page} of ${pages}`, this.pageWidth - this.margin, this.pageHeight - 6, { align: "right" });
    }
  }
}

function liabilityAmount(value: number): ReportCell {
  return { value, danger: value > 0 };
}

export async function createFinancialReportDocument(input: FinancialReportInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const report = new PdfReport(doc);
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${input.dashboard.month}-01T00:00:00Z`),
  );

  report.heading(
    "Financial Position Summary",
    `Reporting month: ${monthLabel} / As of ${formatDate(input.generatedOn)}`,
  );
  report.section("Executive summary", "A concise view of cash, assets, debt and monthly commitments");
  report.metrics([
    {
      label: `Cash balance (${input.dashboard.cashBalanceSource.replaceAll("_", " ")})`,
      value: formatPaise(input.dashboard.cashBalancePaise),
    },
    { label: "Tracked assets", value: formatPaise(input.accounts.totalAssetBalancePaise) },
    { label: "Liability balances", value: formatPaise(input.accounts.totalLiabilityBalancePaise), danger: true },
    {
      label: "Account position",
      value: formatPaise(input.accounts.totalAssetBalancePaise - input.accounts.totalLiabilityBalancePaise),
      danger: input.accounts.totalAssetBalancePaise < input.accounts.totalLiabilityBalancePaise,
    },
    { label: "Monthly income plan", value: formatPaise(input.dashboard.plannedIncomePaise) },
    { label: "Regular expenses", value: formatPaise(input.dashboard.regularExpensePaise) },
    { label: "Monthly EMI", value: formatPaise(input.dashboard.totalEmiPaise), danger: true },
    { label: "Net worth", value: formatPaise(input.wealth.netWorthPaise), danger: input.wealth.netWorthPaise < 0 },
  ]);
  report.paragraph(
    `Current month cash outflow is ${formatPaise(input.dashboard.cashOutflowPaise)}. Regular spending has used ${input.dashboard.budgetUsedPercentage}% of the ${formatPaise(input.dashboard.regularBudgetPaise)} budget.`,
  );

  report.section("Liabilities", `${input.liabilities.activeCount} active / ${input.liabilities.clearedCount} cleared`);
  report.metrics([
    { label: "Current principal", value: formatPaise(input.liabilities.totalPrincipalPaise), danger: true },
    { label: "Monthly EMI", value: formatPaise(input.liabilities.totalEmiPaise), danger: true },
    { label: "Personal payables", value: formatPaise(input.liabilities.otherLiabilityPaise), danger: true },
    { label: "Money to receive", value: formatPaise(input.liabilities.receivablePaise) },
  ]);
  report.table(
    ["Facility", "Type", "Original", "Principal", "EMI", "Rate", "Status"],
    input.liabilities.liabilities.map((liability) => [
      liability.name,
      liability.productType,
      liabilityAmount(liability.originalAmountPaise),
      liabilityAmount(liability.currentPrincipalPaise),
      liabilityAmount(liability.emiPaise),
      liability.annualRateBps === null ? "-" : `${(liability.annualRateBps / 100).toFixed(2)}%`,
      titleCase(liability.status),
    ]),
    [37, 24, 28, 28, 22, 16, 18],
  );

  report.section("Personal balances", "Payables and receivables outside banks");
  report.table(
    ["Person", "Direction", "Amount", "Status", "Note"],
    [...input.liabilities.otherLiabilities, ...input.liabilities.receivables].map((balance) => [
      balance.name,
      titleCase(balance.direction),
      balance.direction === "payable" ? -balance.amountPaise : balance.amountPaise,
      titleCase(balance.status),
      balance.note ?? "-",
    ]),
    [38, 28, 32, 24, 51],
  );

  report.section("Asset accounts", "Balances shown from their configured source of truth");
  report.table(
    ["Account", "Type", "Institution", "Balance", "Source", "Status"],
    input.accounts.accounts
      .filter((account) => account.accountClass === "asset")
      .map((account) => [
        account.name,
        titleCase(account.accountType),
        account.institution ?? "Independent",
        account.balancePaise,
        titleCase(account.managedBy),
        account.isActive ? "Active" : "Archived",
      ]),
    [43, 26, 34, 30, 24, 20],
  );

  report.section("Savings and investments", `${input.wealth.assets.length} tracked positions`);
  report.metrics([
    { label: "Savings", value: formatPaise(input.wealth.savingsPaise) },
    { label: "Investments", value: formatPaise(input.wealth.investmentPaise) },
    { label: "Goal allocated", value: formatPaise(input.wealth.allocatedPaise) },
    { label: "Available cash", value: formatPaise(input.wealth.availableCashPaise) },
  ]);
  report.table(
    ["Position", "Class", "Institution", "Value", "Allocated", "Liquidity", "Policy"],
    input.wealth.assets.map((asset) => [
      asset.name,
      titleCase(asset.assetType),
      asset.institution ?? "Independent",
      asset.currentValuePaise,
      asset.allocatedPaise,
      titleCase(asset.liquidity),
      titleCase(asset.allocationPolicy),
    ]),
    [37, 24, 29, 27, 27, 21, 28],
  );

  report.section("Goal allocations", "Savings and investments earmarked for financial goals");
  report.table(
    ["Goal", "Type", "Target", "Funded", "Remaining", "Progress", "Status"],
    input.wealth.goals.map((goal) => [
      goal.name,
      titleCase(goal.goalType),
      goal.targetPaise,
      goal.allocatedPaise,
      goal.remainingPaise,
      `${goal.progressPercentage}%`,
      titleCase(goal.status),
    ]),
    [37, 27, 28, 28, 28, 19, 19],
  );
  report.paragraph(
    "Notes: restricted wallets are included in tracked assets but not in available cash. EPF and NPS Tier I should remain locked and unavailable for short-term goals. Liability balances are displayed in red throughout this report.",
  );

  report.addFooters(input.generatedOn);
  return doc;
}

export async function downloadFinancialReport(input: FinancialReportInput) {
  const doc = await createFinancialReportDocument(input);
  const dateStamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(input.generatedOn);
  doc.save(`finance-hero-summary-${dateStamp}.pdf`);
}
