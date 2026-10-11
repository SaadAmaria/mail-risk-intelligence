import type { MailboxAddress } from "@mri/shared";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Message dates are stored in UTC; every displayed date says so, so output is stable. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "Date missing";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Date missing" : `${dateFmt.format(d)} UTC`;
}

export function formatDay(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "No date" : `${dayFmt.format(d)} UTC`;
}

export function senderName(from: MailboxAddress | null): string {
  if (!from) return "Unknown sender";
  return from.name?.trim() || from.address;
}

export function senderAddress(from: MailboxAddress | null): string | null {
  return from?.address ?? null;
}

export function formatAddresses(list: MailboxAddress[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

export function formatMoney(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US")}`;
  }
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
