import type { ProductStatus } from "@/lib/supabase";

const styles: Record<ProductStatus | "not_scanned", string> = {
  pending: "bg-muted text-muted-foreground",
  match: "bg-success/15 text-success",
  short: "bg-destructive/12 text-destructive",
  excess: "bg-warning/20 text-warning-foreground",
  removed: "bg-muted text-muted-foreground line-through",
  not_scanned: "bg-muted text-muted-foreground",
};

const labels: Record<ProductStatus, string> = {
  pending: "Pending",
  match: "Match",
  short: "Short",
  excess: "Excess",
  removed: "Removed",
};


export function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export function SummaryStatusBadge({ status }: { status: "in_progress" | "done" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        status === "done" ? "bg-success/15 text-success" : "bg-accent/25 text-accent-foreground"
      }`}
    >
      {status === "done" ? "Done" : "In Progress"}
    </span>
  );
}
