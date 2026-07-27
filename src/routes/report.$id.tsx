import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase, type Product, type Summary } from "@/lib/supabase";
import { downloadDetailedReport, downloadEasyReport, plainStatus } from "@/lib/excel";

export const Route = createFileRoute("/report/$id")({
  head: () => ({
    meta: [
      { title: "Final Dispatch Report | Mewar Distribution Centre" },
      {
        name: "description",
        content:
          "Final verification report with match, short, excess and not-scanned counts, plus detailed and easy Excel downloads.",
      },
      { property: "og:title", content: "Final Dispatch Report | Mewar Distribution Centre" },
      {
        property: "og:description",
        content: "Verification results with detailed and easy Excel report downloads.",
      },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  return (
    <AppShell>
      <FinalReport />
    </AppShell>
  );
}

function FinalReport() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [shared, setShared] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", id],
    queryFn: async () => {
      const [s, p] = await Promise.all([
        supabase.from("summaries").select("*").eq("id", id).single(),
        supabase.from("products").select("*").eq("summary_id", id).order("created_at"),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      return { summary: s.data as Summary, products: (p.data ?? []) as Product[] };
    },
  });

  if (isLoading) return <Spinner label="Building report..." />;
  if (error || !data)
    return (
      <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error)?.message ?? "Report not found"}
      </p>
    );

  const { summary, products } = data;
  const counts = {
    match: products.filter((p) => p.status === "match").length,
    short: products.filter((p) => p.status === "short").length,
    excess: products.filter((p) => p.status === "excess").length,
    pending: products.filter((p) => p.status === "pending").length,
  };
  const isShared = shared ?? !!summary.shared_with_uploaders;

  async function toggleShare(next: boolean) {
    setSharing(true);
    const { error } = await supabase
      .from("summaries")
      .update({ shared_with_uploaders: next })
      .eq("id", id);
    setSharing(false);
    if (error) {
      const missingColumn =
        error.code === "PGRST204" ||
        error.code === "42703" ||
        error.message.includes("shared_with_uploaders");
      toast.error(
        missingColumn
          ? "Sharing needs the 'shared_with_uploaders' column on the summaries table. Add it in Supabase, then try again."
          : `Could not update sharing: ${error.message}`,
      );
      return;
    }

    setShared(next);
    toast.success(next ? "Report shared with uploaders" : "Sharing turned off");
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Button>

      <section className="surface-card space-y-4 bg-[image:var(--gradient-brand)] p-5 text-primary-foreground">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] opacity-75">Final Report</p>
          <h1 className="font-display text-2xl font-semibold">{summary.title}</h1>
          <p className="mt-1 text-sm opacity-85">
            {new Date(summary.created_at).toLocaleDateString()} · {summary.uploaded_by || "Unknown"}{" "}
            · {products.length} products
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["Match", counts.match],
            ["Short", counts.short],
            ["Excess", counts.excess],
            ["Not Scanned", counts.pending],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-primary-foreground/10 px-2 py-3">
              <p className="font-display text-xl font-semibold">{value as number}</p>
              <p className="text-[11px] uppercase tracking-wide opacity-75">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-card space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Downloads</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="hero"
            size="lg"
            onClick={() => {
              downloadDetailedReport(summary, products);
              toast.success("Detailed report downloaded");
            }}
          >
            <FileSpreadsheet className="h-5 w-5" /> Download Detailed Report
          </Button>
          <Button
            variant="gold"
            size="lg"
            onClick={() => {
              downloadEasyReport(summary, products);
              toast.success("Easy report downloaded");
            }}
          >
            <Download className="h-5 w-5" /> Download Easy Report
          </Button>
        </div>

        {user?.role === "admin" ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-secondary/70 p-3">
            <Label htmlFor="share" className="flex items-center gap-2 text-sm">
              <Share2 className="h-4 w-4 text-primary" />
              Send to Uploaders
              {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            </Label>
            <Switch id="share" checked={isShared} disabled={sharing} onCheckedChange={toggleShare} />
          </div>
        ) : null}
      </section>

      <section className="surface-card overflow-hidden p-0">
        <h2 className="border-b border-border p-4 font-display text-lg font-semibold">Products</h2>
        <div className="divide-y divide-border">
          {products.map((p) => (
            <div key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.product_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{p.barcode}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <p className="rounded-lg bg-secondary/70 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Required</span>
                  <br />
                  {p.required_box ?? 0} Box · {p.required_pcs ?? 0} Pcs · ₹{p.required_mrp ?? 0}
                </p>
                <p className="rounded-lg bg-secondary/70 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Completed</span>
                  <br />
                  {p.completed_box ?? "—"} Box · {p.completed_pcs ?? "—"} Pcs · ₹
                  {p.completed_mrp ?? "—"}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {plainStatus(p)}
                {p.change_note && p.change_note !== "Not Scanned" ? ` · ${p.change_note}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
