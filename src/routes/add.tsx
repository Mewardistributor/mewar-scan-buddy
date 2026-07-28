import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FileUp,
  Loader2,
  Plus,
  Rocket,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { parseDispatchExcel, type ParsedRow } from "@/lib/excel";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "photo" ? ("photo" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Add Dispatch Summary | Mewar Distribution Centre" },
      {
        name: "description",
        content:
          "Upload a MARG daily dispatch Excel sheet, review and edit the parsed product list, then start barcode verification.",
      },
      { property: "og:title", content: "Add Dispatch Summary | Mewar Distribution Centre" },
      {
        property: "og:description",
        content: "Upload a dispatch Excel sheet and start barcode verification.",
      },
    ],
  }),
  component: AddSummaryPage,
});

function AddSummaryPage() {
  return (
    <AppShell>
      <AddSummary />
    </AppShell>
  );
}


let manualSeq = 0;

function AddSummary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { mode } = Route.useSearch();
  const noBarcode = mode === "photo";
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [fileName, setFileName] = useState("");
  const [newItem, setNewItem] = useState({ barcode: "", product_name: "", mrp: "", box: "", pcs: "" });
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) => r.product_name.toLowerCase().includes(q) || r.barcode.toLowerCase().includes(q),
    );
  }, [rows, search]);

  async function onFile(file: File) {
    setParsing(true);
    try {
      const parsed = await parseDispatchExcel(file, { noBarcode });
      if (parsed.length === 0) {
        toast.error("No product rows found in this file");
      } else {
        toast.success(`${parsed.length} products parsed`);
      }
      setRows(parsed);
      setFileName(file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read this Excel file");
    } finally {
      setParsing(false);
    }
  }

  function removeRow(key: string) {
    setRows((prev) => {
      if (!prev) return prev;
      const row = prev.find((r) => r.key === key);
      if (row) {
        toast.info(
          `Removed — Was: [${row.product_name}, MRP ₹${row.required_mrp}, Box ${row.required_box}, Pcs ${row.required_pcs}]`,
        );
      }
      return prev.filter((r) => r.key !== key);
    });
  }

  function editMrp(key: string, value: string) {
    const next = Number(value);
    setRows((prev) =>
      prev
        ? prev.map((r) => {
            if (r.key !== key) return r;
            if (!Number.isFinite(next) || next === r.required_mrp) return { ...r, required_mrp: Number.isFinite(next) ? next : r.required_mrp };
            const original = r.change_note?.startsWith("MRP changed")
              ? r.change_note.replace(/^MRP changed — Was: ₹([\d.]+).*/, "$1")
              : String(r.required_mrp);
            return {
              ...r,
              required_mrp: next,
              change_note: `MRP changed — Was: ₹${original}, Now: ₹${next}`,
            };
          })
        : prev,
    );
  }

  function addManual() {
    const barcode = newItem.barcode.trim();
    const name = newItem.product_name.trim();
    if (!name || (!noBarcode && !barcode)) {
      toast.error(noBarcode ? "Product name is required" : "Barcode and product name are required");
      return;
    }
    manualSeq += 1;
    setRows((prev) => [
      ...(prev ?? []),
      {
        key: `manual-${manualSeq}-${barcode || name}`,
        barcode,
        product_name: name,

        required_mrp: Number(newItem.mrp) || 0,
        required_box: Number(newItem.box) || 0,
        required_pcs: Number(newItem.pcs) || 0,
        change_note: "Added — New Item",
      },
    ]);
    setNewItem({ barcode: "", product_name: "", mrp: "", box: "", pcs: "" });
    setShowAdd(false);
    toast.success("Item added");
  }

  async function confirmAndStart() {
    const t = title.trim();
    if (!t) {
      toast.error("Please enter a title for this summary");
      return;
    }
    if (!rows || rows.length === 0) {
      toast.error("Add at least one product before starting");
      return;
    }
    setSaving(true);
    const { data: summary, error } = await supabase
      .from("summaries")
      .insert({
        title: t,
        status: "in_progress",
        uploaded_by: user?.username ?? null,
      })

      .select()
      .single();

    if (error || !summary) {
      setSaving(false);
      toast.error(`Could not create summary: ${error?.message ?? "unknown error"}`);
      return;
    }

    const payload = rows.map((r) => ({
      summary_id: summary.id,
      barcode: r.barcode,
      product_name: r.product_name,
      required_mrp: r.required_mrp,
      required_box: r.required_box,
      required_pcs: r.required_pcs,
      completed_mrp: null,
      completed_box: null,
      completed_pcs: null,
      status: "pending",
      change_note: r.change_note,
    }));

    const { error: pErr } = await supabase.from("products").insert(payload);
    setSaving(false);
    if (pErr) {
      toast.error(`Could not save products: ${pErr.message}`);
      return;
    }
    toast.success("Summary created — start scanning");
    navigate({ to: "/scan/$id", params: { id: String(summary.id) } });
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Button>

      <section className="surface-card space-y-4 p-5">
        <div>
          <h1 className="font-display text-xl font-semibold">
            {noBarcode ? "New Dispatch Summary (Without Scanner)" : "New Dispatch Summary"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {noBarcode
              ? "Name this dispatch, then upload the MARG dispatch Excel sheet that has no barcode column. Verification will use Match by Photo."
              : "Name this dispatch, then upload the MARG daily dispatch Excel sheet."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="title">Summary title</Label>
          <Input
            id="title"
            className="h-11"
            placeholder="e.g. 27 July Dispatch"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Excel file (.xlsx)</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="lg"
            className="w-full border-dashed"
            onClick={() => fileRef.current?.click()}
            disabled={parsing}
          >
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {fileName || (parsing ? "Reading file..." : "Choose Excel file")}
          </Button>
        </div>
      </section>

      {rows ? (
        <section className="surface-card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">
              Preview · {rows.length} item{rows.length === 1 ? "" : "s"}
            </h2>
            <Button variant="gold" size="sm" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          </div>

          {showAdd ? (
            <div className="grid gap-2 rounded-xl bg-secondary/60 p-3 sm:grid-cols-6">
              {noBarcode ? null : (
                <Input
                  placeholder="Barcode"
                  value={newItem.barcode}
                  onChange={(e) => setNewItem({ ...newItem, barcode: e.target.value })}
                  className="sm:col-span-2"
                />
              )}

              <Input
                placeholder="Product name"
                value={newItem.product_name}
                onChange={(e) => setNewItem({ ...newItem, product_name: e.target.value })}
                className="sm:col-span-2"
              />
              <Input
                placeholder="MRP"
                inputMode="decimal"
                value={newItem.mrp}
                onChange={(e) => setNewItem({ ...newItem, mrp: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Box"
                  inputMode="numeric"
                  value={newItem.box}
                  onChange={(e) => setNewItem({ ...newItem, box: e.target.value })}
                />
                <Input
                  placeholder="Pcs"
                  inputMode="numeric"
                  value={newItem.pcs}
                  onChange={(e) => setNewItem({ ...newItem, pcs: e.target.value })}
                />
              </div>
              <Button className="sm:col-span-6" variant="hero" onClick={addManual}>
                Add to list
              </Button>
            </div>
          ) : null}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-9"
              placeholder="Search by product name or barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No matching items"
              description="Try a different product name or barcode."
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((r) => (
                <div key={r.key} className="rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.product_name}</p>
                      {r.barcode ? (
                        <p className="font-mono text-xs text-muted-foreground">{r.barcode}</p>
                      ) : null}

                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeRow(r.key)} aria-label="Remove item">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">MRP (₹)</span>
                      <Input
                        inputMode="decimal"
                        value={String(r.required_mrp)}
                        onChange={(e) => editMrp(r.key, e.target.value)}
                      />
                    </label>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Box</span>
                      <div className="flex h-10 items-center rounded-lg bg-secondary px-3 font-semibold">
                        {r.required_box}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Pcs</span>
                      <div className="flex h-10 items-center rounded-lg bg-secondary px-3 font-semibold">
                        {r.required_pcs}
                      </div>
                    </div>
                  </div>
                  {r.change_note ? (
                    <p className="mt-2 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent-foreground">
                      {r.change_note}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <Button variant="hero" size="lg" className="w-full" onClick={confirmAndStart} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Confirm & Start Scanning
          </Button>
        </section>
      ) : null}
    </div>
  );
}
