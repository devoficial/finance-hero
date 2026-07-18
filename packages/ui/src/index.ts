const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatInr(rupees: number): string {
  return inrFormatter.format(rupees).replace("₹", "Rs ");
}
