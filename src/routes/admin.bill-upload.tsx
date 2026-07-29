import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, UploadCloud, FileSpreadsheet, Loader2, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/bill-upload")({
  component: () => (
    <AppShell>
      <BillUploadScreen />
    </AppShell>
  ),
});

type RowResult = {
  status: "success" | "failed" | "duplicate";
  message: string;
  shopName?: string;
  billNumber?: string;
};

type FileJob = {
  file: File;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  results: RowResult[];
};

function normalizeHeader(h: string) {
  return String(h ?? "").trim().toLowerCase();
}

function findCol(headers: string[], candidates: string[]) {
  return headers.findIndex((h) => candidates.some((c) => h.includes(c)));
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(value).trim();
  const dmY = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmY) {
    let [, d, m, y] = dmY;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// Detects header row + column indices for the real Mewar invoice format:
// SL, HSN NO, Item Name, MRP, CS QTY, PCS QTY, Rate, ... Net Amount
function findItemHeaderRow(rows: unknown[][]) {
  for (let i = 0; i < rows.length; i++) {
    const norm = rows[i].map((c) => normalizeHeader(String(c ?? "")));
    if (norm.some((h) => h.includes("item name")) && norm.some((h) => h.includes("qty"))) {
      return i;
    }
  }
  return -1;
}

function extractInvoiceMeta(rows: unknown[][]) {
  // Invoice No / Invoice Date / Retailer Name appear as label:value pairs
  // scattered in the top rows of the sheet — scan every cell for the label
  // and take the next non-empty cell in the same row as the value.
  let billNumber = "";
  let billDate: string | null = null;
  let shopName = "";
  let ownerName = "";

  for (const row of rows.slice(0, 25)) {
    for (let c = 0; c < row.length; c++) {
      const label = normalizeHeader(String(row[c] ?? ""));
      const rest = row.slice(c + 1).find((v) => v !== undefined && v !== "" && v !== ":");
      if (!rest) continue;

      if (!billNumber && label.includes("invoice no")) billNumber = String(rest).trim();
      if (!billDate && label.includes("invoice date")) billDate = parseExcelDate(rest);
      if (!shopName && label.includes("retailer name")) shopName = String(rest).trim();
      if (!ownerName && label.includes("salesman name")) ownerName = String(rest).trim();
    }
  }
  return { billNumber, billDate, shopName, ownerName };
}

function BillUploadScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const valid = Array.from(files).filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    if (valid.length === 0) {
      toast.error("Please select .xlsx or .xls files only");
      return;
    }
    setJobs((prev) => [
      ...prev,
      ...valid.map((file) => ({ file, status: "queued" as const, progress: 0, results: [] })),
    ]);
  }, []);

  async function processFile(job: FileJob, index: number) {
    setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, status: "processing", progress: 10 } : j)));

    const historyRow = await supabase
      .from("upload_history")
      .insert({ file_name: job.file.name, uploaded_by: user?.id ?? null, status: "processing" })
      .select()
      .single();
    const historyId = historyRow.data?.id as string | undefined;

    const results: RowResult[] = [];

    try {
      const buf = await job.file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      if (!rows.length) throw new Error("Empty file");

      const meta = extractInvoiceMeta(rows);
      if (!meta.billNumber || !meta.shopName) {
        throw new Error("Could not find Invoice No / Retailer Name in this file");
      }

      setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, progress: 40 } : j)));

      // Duplicate check
      const existing = await supabase
        .from("bills")
        .select("id")
        .eq("bill_number", meta.billNumber)
        .eq("shop_name", meta.shopName)
        .maybeSingle();

      if (existing.data) {
        results.push({
          status: "duplicate",
          message: `Bill ${meta.billNumber} for ${meta.shopName} already exists`,
          shopName: meta.shopName,
          billNumber: meta.billNumber,
        });
        if (historyId) {
          await supabase.from("upload_logs").insert({
            upload_history_id: historyId,
            shop_name: meta.shopName,
            bill_number: meta.billNumber,
            status: "duplicate",
            message: "Duplicate bill skipped",
          });
          await supabase
            .from("upload_history")
            .update({ status: "partial", total_rows: 1, success_rows: 0, failed_rows: 0 })
            .eq("id", historyId);
        }
        setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, status: "done", progress: 100, results } : j)));
        return;
      }

      const headerRowIdx = findItemHeaderRow(rows);
      const items: { productName: string; cases: number; pieces: number; amount: number }[] = [];
      let totalAmount = 0;

      if (headerRowIdx !== -1) {
        const headers = rows[headerRowIdx].map((h) => normalizeHeader(String(h ?? "")));
        const col = {
          name: findCol(headers, ["item name"]),
          cases: findCol(headers, ["cs qty", "case"]),
          pieces: findCol(headers, ["pcs qty", "piece"]),
          amount: findCol(headers, ["net amount", "amount"]),
        };

        for (const r of rows.slice(headerRowIdx + 1)) {
          const productName = col.name !== -1 ? String(r[col.name] ?? "").trim() : "";
          if (!productName || /^total/i.test(productName)) continue;
          const cases = col.cases !== -1 ? Number(r[col.cases]) || 0 : 0;
          const pieces = col.pieces !== -1 ? Number(r[col.pieces]) || 0 : 0;
          const amount = col.amount !== -1 ? Number(r[col.amount]) || 0 : 0;
          items.push({ productName, cases, pieces, amount });
          totalAmount += amount;
        }
      }

      setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, progress: 70 } : j)));

      const billInsert = await supabase
        .from("bills")
        .insert({
          shop_name: meta.shopName,
          owner_name: meta.ownerName || null,
          bill_number: meta.billNumber,
          bill_date: meta.billDate,
          total_amount: totalAmount,
          source_file_name: job.file.name,
          uploaded_by: user?.id ?? null,
        })
        .select()
        .single();

      if (billInsert.error || !billInsert.data) {
        throw new Error(billInsert.error?.message ?? "Could not save bill");
      }

      const billId = billInsert.data.id as string;

      if (items.length) {
        const itemsInsert = await supabase.from("bill_items").insert(
          items.map((it) => ({
            bill_id: billId,
            product_name: it.productName,
            cases: it.cases,
            pieces: it.pieces,
            amount: it.amount,
          }))
        );
        if (itemsInsert.error) throw new Error(`Bill saved but items failed: ${itemsInsert.error.message}`);
      }

      results.push({
        status: "success",
        message: `Saved with ${items.length} product line(s)`,
        shopName: meta.shopName,
        billNumber: meta.billNumber,
      });

      if (historyId) {
        await supabase.from("upload_logs").insert({
          upload_history_id: historyId,
          bill_id: billId,
          shop_name: meta.shopName,
          bill_number: meta.billNumber,
          status: "success",
          message: "Bill and items saved",
        });
        await supabase
          .from("upload_history")
          .update({ status: "success", total_rows: 1, success_rows: 1, failed_rows: 0 })
          .eq("id", historyId);
      }

      setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, status: "done", progress: 100, results } : j)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read this file";
      results.push({ status: "failed", message: msg });
      if (historyId) {
        await supabase
          .from("upload_history")
          .update({ status: "failed", error_summary: msg })
          .eq("id", historyId);
        await supabase.from("upload_logs").insert({
          upload_history_id: historyId,
          status: "failed",
          message: msg,
        });
      }
      setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, status: "error", progress: 100, results } : j)));
    }
  }

  async function startUpload() {
    setRunning(true);
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === "queued") {
        // eslint-disable-next-line no-await-in-loop
        await processFile(jobs[i], i);
      }
    }
    setRunning(false);
    toast.success("Upload batch finished");
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  const successTotal = jobs.reduce((s, j) => s + j.results.filter((r) => r.status === "success").length, 0);
  const failedTotal = jobs.reduce((s, j) => s + j.results.filter((r) => r.status === "failed").length, 0);
  const duplicateTotal = jobs.reduce((s, j) => s + j.results.filter((r) => r.status === "duplicate").length, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <h1 className="font-display text-lg font-semibold">Bill Upload</h1>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`surface-card flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors ${
          dragActive ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <UploadCloud className="h-8 w-8 text-primary" />
        <p className="font-medium">Drag & drop Bill Excel files here, or click to browse</p>
        <p className="text-xs text-muted-foreground">Supports .xlsx and .xls — one bill per file, multiple files allowed</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {jobs.length > 0 ? (
        <section className="surface-card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{jobs.length} file(s) queued</p>
            <Button variant="hero" size="sm" onClick={startUpload} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Start Upload
            </Button>
          </div>

          {(successTotal > 0 || failedTotal > 0 || duplicateTotal > 0) && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-success/10 px-2 py-2">
                <p className="font-display text-lg font-semibold text-success">{successTotal}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Success</p>
              </div>
              <div className="rounded-xl bg-destructive/10 px-2 py-2">
                <p className="font-display text-lg font-semibold text-destructive">{failedTotal}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Failed</p>
              </div>
              <div className="rounded-xl bg-warning/10 px-2 py-2">
                <p className="font-display text-lg font-semibold text-warning-foreground">{duplicateTotal}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Duplicate</p>
              </div>
            </div>
          )}

          <ul className="divide-y divide-border">
            {jobs.map((job, i) => (
              <li key={i} className="space-y-2 py-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.file.name}</span>
                  {job.status === "processing" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : job.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  ) : job.status === "error" ? (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  ) : null}
                </div>
                {job.status !== "queued" ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-[image:var(--gradient-brand)] transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                ) : null}
                {job.results.length > 0 ? (
                  <ul className="space-y-1 pl-6 text-xs">
                    {job.results.map((r, ri) => (
                      <li
                        key={ri}
                        className={
                          r.status === "success"
                            ? "text-success"
                            : r.status === "duplicate"
                              ? "text-warning-foreground"
                              : "text-destructive"
                        }
                      >
                        {r.billNumber ? `Bill ${r.billNumber} (${r.shopName}): ` : ""}
                        {r.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
