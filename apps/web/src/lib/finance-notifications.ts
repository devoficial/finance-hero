import type { DashboardResponse } from "@finance-hero/contracts";

const PREFIX = "finance-hero:notification:";

type NotificationDashboard = Pick<
  DashboardResponse,
  "budgetUsedPercentage" | "cashBalancePaise" | "dangerAlert" | "month" | "totalEmiPaise"
>;

export interface FinanceNotificationDecision {
  body: string;
  key: string;
  title: string;
}

function notifyOnce(key: string, title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (localStorage.getItem(`${PREFIX}${key}`)) return;
  new Notification(title, { body, icon: "/finance-hero-192.png", tag: key });
  localStorage.setItem(`${PREFIX}${key}`, new Date().toISOString());
}

export async function requestFinanceNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

export function financeNotificationDecisions(
  dashboard: NotificationDashboard,
  now = new Date(),
): FinanceNotificationDecision[] {
  const decisions: FinanceNotificationDecision[] = [];
  const month = dashboard.month;
  if (dashboard.dangerAlert) {
    decisions.push({
      key: `danger:${month}`,
      title: "Finance Hero budget warning",
      body: `${dashboard.budgetUsedPercentage}% of the regular budget is already used before day 20.`,
    });
  }

  const localDay = Number(new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }).format(now));
  if (localDay <= 3) {
    const balance = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(dashboard.cashBalancePaise / 100);
    decisions.push({
      key: `month-start:${month}`,
      title: `Finance Hero ${month} opening check`,
      body: `Available cash is ${balance}. Scheduled EMIs are ${Math.round(dashboard.totalEmiPaise / 100).toLocaleString("en-IN")} rupees.`,
    });
  }

  return decisions;
}

export function evaluateFinanceNotifications(dashboard: DashboardResponse, now = new Date()) {
  for (const decision of financeNotificationDecisions(dashboard, now)) {
    notifyOnce(decision.key, decision.title, decision.body);
  }
}
