import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileText, Loader2, RotateCcw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase, type Product, type Summary } from "@/lib/supabase";
import { downloadFinalReport, downloadChangesSummary, plainStatus } from "@/lib/excel";

export const Route = createFileRoute("/report/$id")({
  head: () => ({
    meta: [
      { title: "Final Dispatch Report | Mewar Distribution Centre" },
      {
        name: "description",
        content:
          "Final verification report with match, short, excess and not-scanned counts, plus Excel and Word downloads.",
      },
      { property: "og:title", content: "Final Dispatch Report | Mewar Distribution Centre" },
      {
        property: "og:description",
        content: "Verification results with Excel and Word report downloads.",
      },
    ],
  }),
  component: ReportPage,
});

const GRACE_MS = 5 * 60 * 1000;

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
  const qc = useQueryClient();
  const { user } = useAuth();
  const [shared, setShared] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState<"excel" | "word" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reopening, setReopening] = useState(false);

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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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

  const finalizedAt = (summary as any).finalized_at
    ? new Date((summary as any).finalized_at).getTime()
    : null;
  const msLeft = finalizedAt ? GRACE_MS - (now - finalizedAt) : 0;
  const canReopen = user?.role === "admin" && finalizedAt && msLeft > 0;
  const minutesLeft = Math.max(0, Math.floor(msLeft / 60000));
  const secondsLeft = Math.max(0, Math.floor((msLeft % 60000) / 1000));

  async function handleReopen() {
    setReopening(true);
    const { error } = await supabase.from("summaries").update({ status: "in_progress" }).eq("id", id);
    setReopening(false);
    if (error) {
      toast.error(`Could not reopen: ${error.message}`);
      return;
    }
    qc.invalidateQueries({ queryKey: ["summaries"] });
    toast.success("Reopened for editing");
    navigate({ to: "/scan/$id", params: { id } });
  }

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

  async function handleDownload(kind: "excel" | "word") {
    setDownloading(kind);
    try {
      if (kind === "excel") {
        await downloadFinalReport(summary, products);
        toast.success("Final report downloaded");
      } else {
        await downloadChangesSummary(summary, products);
        toast.success("Changes summary downloaded");
      }
    } catch (e) {
      toast.error(`Download failed: ${(e as Error).message}`);
    } finally {
      setDownloading(null);
    }
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

      {canReopen ? (
        <section className="surface-card flex items-center justify-between gap-3 border border-warning bg-warning/10 p-4">
          <div>
            <p className="text-sm font-semibold">Grace period active</p>
            <p className="text-xs text-muted-foreground">
              {minutesLeft}m {secondsLeft}s left to reopen and fix missed items
            </p>
          </div>
          <Button variant="outline" onClick={handleReopen} disabled={reopening}>
            {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reopen
          </Button>
        </section>
      ) : null}

      <section className="surface-card space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Downloads</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="hero" size="lg" onClick={() => handleDownload("excel")} disabled={downloading === "excel"}>
            {downloading === "excel" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            Download Final Report
          </Button>
          <Button variant="gold" size="lg" onClick={() => handleDownload("word")} disabled={downloading === "word"}>
            {downloading === "word" ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
            Download Changes Summary
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
