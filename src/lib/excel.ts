import * as XLSX from "xlsx";
import type { Product, Summary } from "./supabase";

export type ParsedRow = {
  key: string;
  barcode: string;
  product_name: string;
  required_mrp: number;
  required_box: number;
  required_pcs: number;
  change_note: string | null;
};

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function parseDispatchExcel(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });

  // Locate the header row (SNO | BARCODE | PRODUCT NAME | M.R.P. | BOX | PCS | VALUE)
  let headerIdx = rows.findIndex((r) =>
    r.some((c) => String(c).trim().toUpperCase().replace(/\./g, "") === "BARCODE"),
  );
  if (headerIdx === -1) headerIdx = 5;

  const header = (rows[headerIdx] ?? []).map((c) => String(c).trim().toUpperCase().replace(/\./g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iBarcode = col("BARCODE");
  const iName = col("PRODUCT NAME", "PRODUCTNAME", "ITEM NAME");
  const iMrp = col("MRP", "M R P");
  const iBox = col("BOX");
  const iPcs = col("PCS", "PIECES");

  const out: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const barcode = String(iBarcode >= 0 ? (r[iBarcode] ?? "") : "").trim();
    const name = String(iName >= 0 ? (r[iName] ?? "") : "").trim();
    const joined = r.map((c) => String(c).trim()).join(" ").toUpperCase();
    // Skip totals rows like "58 ITEMS QTY: 5470"
    if (!barcode || !name) continue;
    if (/ITEMS?\s+QTY/.test(joined) || /^TOTAL/.test(joined)) continue;
    out.push({
      key: `${barcode}-${i}`,
      barcode,
      product_name: name,
      required_mrp: num(iMrp >= 0 ? r[iMrp] : 0),
      required_box: num(iBox >= 0 ? r[iBox] : 0),
      required_pcs: num(iPcs >= 0 ? r[iPcs] : 0),
      change_note: null,
    });
  }
  return out;
}

function saveWorkbook(rows: unknown[][], sheetName: string, filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const widths = (rows[0] as unknown[]).map((_, c) =>
    Math.min(
      46,
      Math.max(12, ...rows.map((r) => String((r as unknown[])[c] ?? "").length + 2)),
    ),
  );
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "report";

export function downloadDetailedReport(summary: Summary, products: Product[]) {
  const rows: unknown[][] = [
    [
      "Barcode",
      "Product Name",
      "Required MRP",
      "Required Box",
      "Required Pcs",
      "Completed MRP",
      "Completed Box",
      "Completed Pcs",
      "Status",
      "Change Note",
    ],
    ...products.map((p) => [
      p.barcode ?? "",
      p.product_name ?? "",
      p.required_mrp ?? 0,
      p.required_box ?? 0,
      p.required_pcs ?? 0,
      p.completed_mrp ?? "",
      p.completed_box ?? "",
      p.completed_pcs ?? "",
      p.status === "pending" ? "Not Scanned" : p.status.charAt(0).toUpperCase() + p.status.slice(1),
      p.change_note ?? "",
    ]),
  ];
  saveWorkbook(rows, "Detailed", `${safe(summary.title)}_detailed.xlsx`);
}

export function plainStatus(p: Product) {
  if (p.status === "pending") return "Not Scanned";
  const rb = p.required_box ?? 0;
  const rp = p.required_pcs ?? 0;
  const cb = p.completed_box ?? 0;
  const cp = p.completed_pcs ?? 0;
  if (p.status === "match") return "Match";
  if (p.status === "short") return `Short by ${Math.max(0, rb - cb)} Box, ${Math.max(0, rp - cp)} Pcs`;
  return `Excess by ${Math.max(0, cb - rb)} Box, ${Math.max(0, cp - rp)} Pcs`;
}

export function downloadEasyReport(summary: Summary, products: Product[]) {
  const rows: unknown[][] = [["Product", "MRP", "Box", "Pcs", "Status", "Note"]];
  for (const p of products) {
    rows.push([
      `${p.product_name ?? ""} (Original)`,
      p.required_mrp ?? 0,
      p.required_box ?? 0,
      p.required_pcs ?? 0,
      "",
      "",
    ]);
    rows.push([
      `${p.product_name ?? ""} (Actual)`,
      p.completed_mrp ?? "",
      p.completed_box ?? "",
      p.completed_pcs ?? "",
      plainStatus(p),
      p.change_note ?? "",
    ]);
  }
  saveWorkbook(rows, "Easy Report", `${safe(summary.title)}_easy.xlsx`);
}
