import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, PlayCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase, type Bill, type Chalan } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/matching")({
  component: () => (
    <AppShell>
      <MatchingScreen />
    </AppShell>
  ),
});

function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

type ResultRow = {
  chalan: Chalan;
  bill: Bill | null;
  method: "bill_number" | "shop_and_date" | "shop_only" | "unmatched";
};

function MatchingScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  async function runMatching() {
    setRunning(true);
    setResults(null);
    try {
      const [chalansRes, billsRes] = await Promise.all([
        supabase.from("chalans").select("*"),
        supabase.from("bills").select("*"),
      ]);
      if (chalansRes.error) throw chalansRes.error;
      if (billsRes.error) throw billsRes.error;

      const chalans = (chalansRes.data ?? []) as Chalan[];
      const bills = (billsRes.data ?? []) as Bill[];

      const byBillNumber = new Map<string, Bill[]>();
      const byNameDate = new Map<string, Bill[]>();
      const byName = new Map<string, Bill[]>();

      for (const b of bills) {
        const bn = normalizeName(b.bill_number);
        if (!byBillNumber.has(bn)) byBillNumber.set(bn, []);
        byBillNumber.get(bn)!.push(b);

        const nameKey = normalizeName(b.shop_name);
        if (!byName.has(nameKey)) byName.set(nameKey, []);
        byName.get(nameKey)!.push(b);

        if (b.bill_date) {
          const ndKey = `${nameKey}__${b.bill_date}`;
          if (!byNameDate.has(ndKey)) byNameDate.set(ndKey, []);
          byNameDate.get(ndKey)!.push(b);
        }
      }

      const rows: ResultRow[] = [];

      for (const c of chalans) {
        let bill: Bill | null = null;
        let method: ResultRow["method"] = "unmatched";

        // Priority 1: Bill Number (exact)
        const byBn = byBillNumber.get(normalizeName(c.bill_number));
        if (byBn && byBn.length === 1) {
          bill = byBn[0];
          method = "bill_number";
        } else if (byBn && byBn.length > 1) {
          // Multiple bills share this bill number — narrow by shop name too
          const narrowed = byBn.find((b) => normalizeName(b.shop_name) === normalizeName(c.party_name));
          if (narrowed) {
            bill = narrowed;
            method = "bill_number";
          }
        }

        // Priority 2: Shop Name + Date
        if (!bill && c.chalan_date) {
          const key = `${normalizeName(c.party_name)}__${c.chalan_date}`;
          const byNd = byNameDate.get(key);
          if (byNd && byNd.length === 1) {
            bill = byNd[0];
            method = "shop_and_date";
          }
        }

        // Priority 3: Shop Name only (if exactly one bill for that shop)
        if (!bill) {
          const byN = byName.get(normalizeName(c.party_name));
          if (byN && byN.length === 1) {
            bill = byN[0];
            method = "shop_only";
          }
        }

        rows.push({ chalan: c, bill, method });
      }

      // Persist: update chalans with matched bill_id + owner_name, save run + results
      const matchedRows = rows.filter((r) => r.bill);
      const unmatchedRows = rows.filter((r) => !r.bill);

      const runInsert = await supabase
        .from("matching_runs")
        .insert({
          run_by: user?.id ?? null,
          total_chalans: rows.length,
          matched_count: matchedRows.length,
          unmatched_count: unmatchedRows.length,
        })
        .select()
        .single();

      const runId = runInsert.data?.id as string | undefined;

      for (const r of matchedRows) {
        await supabase
          .from("chalans")
          .update({
            bill_id: r.bill!.id,
            owner_name: r.bill!.owner_name,
            status: r.chalan.status === "pending" ? "dispatched" : r.chalan.status,
          })
          .eq("id", r.chalan.id);
      }

      if (runId) {
        const logRows = rows.map((r) => ({
          matching_run_id: runId,
          chalan_id: r.chalan.id,
          bill_id: r.bill?.id ?? null,
          match_method: r.method,
        }));
        await supabase.from("matching_results").insert(logRows);
      }

      setResults(rows);
      toast.success(`Matching complete: ${matchedRows.length} matched, ${unmatchedRows.length} unmatched`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Matching failed");
    } finally {
      setRunning(false);
    }
  }

  const matchedCount = results?.filter((r) => r.bill).length ?? 0;
  const unmatchedCount = results?.filter((r) => !r.bill).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <h1 className="font-display text-lg font-semibold">Bill ↔ Chalan Matching</h1>
      </div>

      <section className="surface-card flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Matches every chalan to its bill automatically using Bill Number, then Shop Name + Date, then Shop Name.
        </p>
        <Button variant="hero" size="lg" onClick={runMatching} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {running ? "Matching..." : "Run Matching"}
        </Button>
      </section>

      {results ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-success/10 px-2 py-3">
              <p className="font-display text-xl font-semibold text-success">{matchedCount}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Matched</p>
            </div>
            <div className="rounded-xl bg-destructive/10 px-2 py-3">
              <p className="font-display text-xl font-semibold text-destructive">{unmatchedCount}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unmatched</p>
            </div>
          </div>

          <section className="surface-card p-4">
            <p className="mb-3 text-sm font-semibold">Matching Report</p>
            <ul className="divide-y divide-border">
              {results.map((r) => (
                <li key={r.chalan.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.chalan.party_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      Bill {r.chalan.bill_number} · ₹{r.chalan.bill_value}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {r.bill ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {r.method.replace("_", " ")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                        <XCircle className="h-3.5 w-3.5" /> No matching bill
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
