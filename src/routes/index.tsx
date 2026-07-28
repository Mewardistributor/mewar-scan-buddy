import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  Download,
  FileText,
  ImagePlus,
  Inbox,

  Loader2,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState, Spinner } from "@/components/AppShell";
import { SummaryStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { supabase, type Product, type Summary } from "@/lib/supabase";
import { downloadFinalReport, downloadChangesSummary } from "@/lib/excel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dispatch Dashboard | Mewar Distribution Centre" },
      {
        name: "description",
        content:
          "Warehouse dispatch verification dashboard for Mewar Distribution Centre — upload dispatch summaries, scan barcodes and download verification reports.",
      },
      { property: "og:title", content: "Dispatch Dashboard | Mewar Distribution Centre" },
      {
        property: "og:description",
        content: "Warehouse dispatch verification dashboard for Mewar Distribution Centre — upload dispatch summaries, scan barcodes and download verification reports.",
      },
    ],
  }),
  component: DashboardPage,
});

function formatDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [toDelete, setToDelete] = useState<Summary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["summaries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("summaries")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Summary[];
    },
  });

  const summaries = data ?? [];
  const shared = summaries.filter((s) => s.status === "done" && s.shared_with_uploaders);
  const reports = summaries.filter((s) => s.status === "done");

  const visibleSummaries =
    user?.role === "admin" ? summaries : summaries.filter((s) => s.status === "in_progress");

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const { error: pErr } = await supabase.from("products").delete().eq("summary_id", toDelete.id);
    if (pErr) {
      setDeleting(false);
      toast.error(`Could not delete products: ${pErr.message}`);
      return;
    }
    const { error: sErr } = await supabase.from("summaries").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (sErr) {
      toast.error(`Could not delete summary: ${sErr.message}`);
      return;
    }
    toast.success("Summary deleted");
    setToDelete(null);
    qc.invalidateQueries({ queryKey: ["summaries"] });
  }

  function openSummary(s: Summary) {
    if (s.status === "in_progress") navigate({ to: "/scan/$id", params: { id: s.id } });
    else navigate({ to: "/report/$id", params: { id: s.id } });
  }

  return (
    <div className="space-y-6">
      <section className="surface-card flex flex-col gap-4 overflow-hidden bg-[image:var(--gradient-brand)] p-6 text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] opacity-75">
            {user?.role === "admin" ? "Administrator" : "Uploader"} workspace
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold">Dispatch Summaries</h1>
          <p className="mt-1 text-sm opacity-85">
            {visibleSummaries.length} total ·{" "}
            {visibleSummaries.filter((s) => s.status === "in_progress").length} in progress ·{" "}
            {(user?.role === "admin" ? reports.length : shared.length)} completed
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto">
          <Button asChild variant="gold" size="lg" className="w-full sm:w-auto">
            <Link to="/add">
              <Plus className="h-5 w-5" /> Add Summary
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 sm:w-auto"
          >
            <Link to="/add" search={{ mode: "photo" as const }}>
              <ImagePlus className="h-5 w-5" /> Summary Without Scanner
            </Link>
          </Button>
        </div>

      </section>

      <Tabs defaultValue="all">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="all" className="flex-1 sm:flex-none">
            All Summaries
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex-1 sm:flex-none">
            {user?.role === "admin" ? "Final Reports" : "Shared Reports"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {isLoading ? (
            <Spinner label="Loading summaries..." />
          ) : error ? (
            <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
              {(error as Error).message}
            </p>
          ) : visibleSummaries.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title="No summaries yet"
              description="Upload a MARG dispatch Excel sheet to start verifying a dispatch."
              action={
                <Button asChild variant="hero">
                  <Link to="/add">
                    <Plus className="h-4 w-4" /> Add Summary
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleSummaries.map((s) => (
                <article
                  key={s.id}
                  className="surface-card group flex flex-col gap-3 p-4 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <button
                    className="cursor-pointer text-left"
                    onClick={() => openSummary(s)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-base font-semibold leading-snug">
                        {s.title}
                      </h3>
                      <SummaryStatusBadge status={s.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> {formatDate(s.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3.5 w-3.5" /> {s.uploaded_by || "Unknown"}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 border-t border-border pt-3">
                    <Button size="sm" variant="hero" onClick={() => openSummary(s)}>
                      {s.status === "in_progress" ? "Continue Scanning" : "View Report"}
                    </Button>
                    {/* Delete now available on every summary, any status */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto text-destructive hover:bg-destructive/10"
                      onClick={() => setToDelete(s)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportsList
            summaries={user?.role === "admin" ? reports : shared}
            isLoading={isLoading}
            onDeleted={() => qc.invalidateQueries({ queryKey: ["summaries"] })}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{toDelete?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this summary? This cannot be undone. All scanned
              products in it will be removed too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function ReportsList({
  summaries,
  isLoading,
  onDeleted,
}: {
  summaries: Summary[];
  isLoading: boolean;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Summary | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function download(s: Summary, kind: "excel" | "word") {
    setBusy(`${s.id}-${kind}`);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("summary_id", s.id)
      .order("created_at", { ascending: true });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const products = (data ?? []) as Product[];
    if (kind === "excel") await downloadFinalReport(s, products);
    else await downloadChangesSummary(s, products);
    toast.success("Report downloaded");
  }

  async function confirmDeleteReport() {
    if (!toDelete) return;
    setDeleting(true);
    const { error: pErr } = await supabase.from("products").delete().eq("summary_id", toDelete.id);
    if (pErr) {
      setDeleting(false);
      toast.error(`Could not delete products: ${pErr.message}`);
      return;
    }
    const { error: sErr } = await supabase.from("summaries").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (sErr) {
      toast.error(`Could not delete report: ${sErr.message}`);
      return;
    }
    toast.success("Report deleted");
    setToDelete(null);
    onDeleted();
  }

  if (isLoading) return <Spinner label="Loading reports..." />;

  if (summaries.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-6 w-6" />}
        title={user?.role === "admin" ? "No completed reports yet" : "No shared reports yet"}
        description={
          user?.role === "admin"
            ? "Finish a dispatch verification to generate its final report."
            : "Reports shared by an administrator will appear here."
        }
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {summaries.map((s) => (
        <article key={s.id} className="surface-card space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-base font-semibold">{s.title}</h3>
            <SummaryStatusBadge status={s.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(s.created_at)} · {s.uploaded_by || "Unknown"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="hero" onClick={() => download(s, "excel")} disabled={busy === `${s.id}-excel`}>
              {busy === `${s.id}-excel` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Final Report
            </Button>
            <Button size="sm" variant="gold" onClick={() => download(s, "word")} disabled={busy === `${s.id}-word`}>
              {busy === `${s.id}-word` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Changes Summary
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/report/$id" params={{ id: s.id }}>
                Open
              </Link>
            </Button>
            {isAdmin ? (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto text-destructive hover:bg-destructive/10"
                onClick={() => setToDelete(s)}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : null}
          </div>
        </article>
      ))}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete report "{toDelete?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this completed report and all its product data. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDeleteReport();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
