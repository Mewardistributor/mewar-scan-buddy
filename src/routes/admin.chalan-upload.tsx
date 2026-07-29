import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, UploadCloud, FileSpreadsheet, Loader2, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/chalan-upload")({
  component: () => (
    <AppShell>
      <ChalanUploadScreen />
    </AppShell>
  ),
});

type RowResult = {
  status: "success" | "failed" | "duplicate";
  message: string;
  partyName?: string;
  billNumber?: string;
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

function ChalanUploadScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RowResult[]>([]);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        toast.error("Please select an .xlsx or .xls file");
        return;
      }
      setFileName(file.name);
      setProcessing(true);
      setProgress(5);
      setResults([]);

      const historyRow = await supabase
        .from("upload_history")
        .insert({ file_name: file.name, uploaded_by: user?.id ?? null, status: "processing" })
        .select()
        .single();
      const historyId = historyRow.data?.id as string | undefined;

      const rowResults: RowResult[] = [];
      let successCount = 0;
      let failedCount = 0;

      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
        if (!rows.length) throw new Error("Empty file");

        const headerRowIdx = rows.findIndex((r) => {
          const norm = r.map((c) => normalizeHeader(String(c ?? "")));
          return norm.some((h) => h.includes("bill")) && norm.some((h) => h.includes("party") || h.includes("shop"));
        });
        if (headerRowIdx === -1) throw new Error("Could not find header row (Bill No, Party Name, etc.)");

        const headers = rows[headerRowIdx].map((h) => normalizeHeader(String(h ?? "")));
        const col = {
          sno: findCol(headers, ["sno", "sl no", "s.no"]),
          billNo: findCol(headers, ["bill no", "billno", "bill number"]),
          date: findCol(headers, ["date"]),
          party: findCol(headers, ["party name", "party", "shop name"]),
          billValue: findCol(headers, ["bill value", "value", "amount"]),
          boxes: findCol(headers, ["box"]),
          remarks: findCol(headers, ["remark"]),
        };

        if (col.billNo === -1 || col.party === -1) {
          throw new Error("Missing required columns: Bill No / Party Name");
        }

        setProgress(20);

        const dataRows = rows
          .slice(headerRowIdx + 1)
          .filter((r) => r.some((c) => c !== undefined && c !== ""));

        let processed = 0;
        for (const r of dataRows) {
          processed++;
          setProgress(20 + Math.round((processed / dataRows.length) * 70));

          const billNumber = String(r[col.billNo] ?? "").trim();
          const partyName = col.party !== -1 ? String(r[col.party] ?? "").trim() : "";
          if (!billNumber || !partyName) continue;

          const sno = col.sno !== -1 ? Number(r[col.sno]) || null : null;
          const chalanDate = col.date !== -1 ? parseExcelDate(r[col.date]) : null;
          const billValue = col.billValue !== -1 ? Number(r[col.billValue]) || 0 : 0;
          const boxes = col.boxes !== -1 ? String(r[col.boxes] ?? "").trim() : null;
          const remarks = col.remarks !== -1 ? String(r[col.remarks] ?? "").trim() : null;

          // Duplicate check
          const existing = await supabase
            .from("chalans")
            .select("id")
            .eq("bill_number", billNumber)
            .eq("party_name", partyName)
            .maybeSingle();

          if (existing.data) {
            rowResults.push({
              status: "duplicate",
              message: `Chalan for bill ${billNumber} (${partyName}) already exists`,
              partyName,
              billNumber,
            });
            if (historyId) {
              await supabase.from("upload_logs").insert({
                upload_history_id: historyId,
                shop_name: partyName,
                bill_number: billNumber,
                status: "duplicate",
                message: "Duplicate chalan row skipped",
              });
            }
            continue;
          }

          const insert = await supabase.from("chalans").insert({
            sno,
            bill_number: billNumber,
            chalan_date: chalanDate,
            party_name: partyName,
            bill_value: billValue,
            boxes,
            remarks,
            source_file_name: file.name,
            uploaded_by: user?.id ?? null,
          });

          if (insert.error) {
            failedCount++;
            rowResults.push({
              status: "failed",
              message: insert.error.message,
              partyName,
              billNumber,
            });
            if (historyId) {
              await supabase.from("upload_logs").insert({
                upload_history_id: historyId,
                shop_name: partyName,
                bill_number: billNumber,
                status: "failed",
                message: insert.error.message,
              });
            }
            continue;
          }

          successCount++;
          rowResults.push({
            status: "success",
            message: `Saved (Bill Value ₹${billValue})`,
            partyName,
            billNumber,
          });
          if (historyId) {
            await supabase.from("upload_logs").insert({
              upload_history_id: historyId,
              shop_name: partyName,
              bill_number: billNumber,
              status: "success",
              message: "Chalan row saved",
            });
          }
        }

        if (historyId) {
          await supabase
            .from("upload_history")
            .update({
              status: failedCount > 0 ? (successCount > 0 ? "partial" : "failed") : "success",
              total_rows: dataRows.length,
              success_rows: successCount,
              failed_rows: failedCount,
            })
            .eq("id", historyId);
        }

        setResults(rowResults);
        setProgress(100);
        toast.success("Chalan upload finished");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not read this file";
        if (historyId) {
          await supabase
            .from("upload_history")
            .update({ status: "failed", error_summary: msg })
            .eq("id", historyId);
        }
        setResults([{ status: "failed", message: msg }]);
        setProgress(100);
        toast.error(msg);
      } finally {
        setProcessing(false);
      }
    },
    [user]
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const successTotal = results.filter((r) => r.status === "success").length;
  const failedTotal = results.filter((r) => r.status === "failed").length;
  const duplicateTotal = results.filter((r) => r.status === "duplicate").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <h1 className="font-display text-lg font-semibold">Chalan Upload</h1>
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
        <p className="font-medium">Drag & drop the Chalan Excel file here, or click to browse</p>
        <p className="text-xs text-muted-foreground">Supports .xlsx and .xls — one file with all shops listed</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {fileName ? (
        <section className="surface-card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{fileName}</span>
            {processing ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : results.length > 0 && failedTotal === 0 ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            ) : results.length > 0 ? (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            ) : null}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-[image:var(--gradient-brand)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          {results.length > 0 ? (
            <>
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

              <ul className="max-h-96 space-y-1 overflow-y-auto text-xs">
                {results.map((r, i) => (
                  <li
                    key={i}
                    className={
                      r.status === "success"
                        ? "text-success"
                        : r.status === "duplicate"
                          ? "text-warning-foreground"
                          : "text-destructive"
                    }
                  >
                    {r.billNumber ? `Bill ${r.billNumber} (${r.partyName}): ` : ""}
                    {r.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
