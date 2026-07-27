import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";
import type { Product, Summary } from "./supabase";

// ---------------- EXCEL UPLOAD PARSING (unchanged) ----------------

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

const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "report";

// ---------------- PLAIN STATUS TEXT (used on Report screen) ----------------

export function plainStatus(p: Product): string {
  if (p.status === "match") return "Match";
  if (p.status === "removed") return "Removed";
  if (p.status === "pending") return "Not Scanned";
  const reqBox = p.required_box ?? 0;
  const reqPcs = p.required_pcs ?? 0;
  const compBox = p.completed_box ?? 0;
  const compPcs = p.completed_pcs ?? 0;
  if (p.status === "short") {
    return `Short by ${Math.max(0, reqBox - compBox)} Box, ${Math.max(0, reqPcs - compPcs)} Pcs`;
  }
  if (p.status === "excess") {
    return `Excess by ${Math.max(0, compBox - reqBox)} Box, ${Math.max(0, compPcs - reqPcs)} Pcs`;
  }
  return "Not Scanned";
}

// ---------------- FINAL COMBINED EXCEL REPORT ----------------

const GREEN = "FFC6EFCE";
const RED = "FFFFC7CE";
const YELLOW = "FFFFEB9C";
const ORANGE = "FFFFD9B3";
const GREY = "FFE0E0E0";
const HEADER_BG = "FF1F4E4E";
const HEADER_FONT = "FFFFFFFF";

function isAdminAdded(note: string | null) {
  return !!note && note.toLowerCase().includes("added by admin");
}
function isAdminRemoved(note: string | null) {
  return !!note && note.toLowerCase().includes("removed by admin");
}

// Compares one completed value vs required value → "excess" | "short" | "match"
function fieldDiff(comp: number, req: number): "excess" | "short" | "match" {
  if (comp > req) return "excess";
  if (comp < req) return "short";
  return "match";
}

// Builds a label like "MRP Excess, Pcs Short" from only the fields that actually differ
function buildIssueLabel(
  reqMrp: number,
  reqBox: number,
  reqPcs: number,
  compMrp: number,
  compBox: number,
  compPcs: number,
): string {
  const parts: string[] = [];
  const mrpDiff = fieldDiff(compMrp, reqMrp);
  const boxDiff = fieldDiff(compBox, reqBox);
  const pcsDiff = fieldDiff(compPcs, reqPcs);

  if (mrpDiff !== "match") parts.push(`MRP ${mrpDiff === "excess" ? "Excess" : "Short"}`);
  if (boxDiff !== "match") parts.push(`Box ${boxDiff === "excess" ? "Excess" : "Short"}`);
  if (pcsDiff !== "match") parts.push(`Pcs ${pcsDiff === "excess" ? "Excess" : "Short"}`);

  return parts.length ? `Issue: ${parts.join(", ")}` : "Issue";
}

export async function downloadFinalReport(summary: Summary, products: Product[]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Final Report");

  // Barcode | Product/Info | MRP | Box | Pcs
  sheet.columns = [{ width: 18 }, { width: 32 }, { width: 14 }, { width: 12 }, { width: 12 }];

  sheet.mergeCells("A1:E1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = `Mewar Distribution Centre — ${summary.title}`;
  titleCell.font = { bold: true, size: 14, color: { argb: HEADER_FONT } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
  sheet.getRow(1).height = 26;

  const headerRow = sheet.addRow(["Barcode", "Product / Info", "MRP", "Box", "Pcs"]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { horizontal: "center" };
  });
  sheet.addRow([]);

  const normalProducts = products.filter(
    (p) => !isAdminAdded(p.change_note) && !isAdminRemoved(p.change_note) && p.status !== "removed",
  );
  const adminAdded = products.filter((p) => isAdminAdded(p.change_note));
  const adminRemoved = products.filter((p) => isAdminRemoved(p.change_note) || p.status === "removed");

  for (const p of normalProducts) {
    const reqMrp = p.required_mrp ?? 0;
    const reqBox = p.required_box ?? 0;
    const reqPcs = p.required_pcs ?? 0;
    const compMrp = p.completed_mrp ?? 0;
    const compBox = p.completed_box ?? 0;
    const compPcs = p.completed_pcs ?? 0;

    sheet.addRow([p.barcode ?? "", p.product_name, reqMrp, reqBox, reqPcs]);

    if (p.status === "match") {
      const row = sheet.addRow([p.barcode ?? "", "CORRECT", compMrp, compBox, compPcs]);
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
      });
      const labelCell = row.getCell(2);
      labelCell.font = { bold: true, size: 13 };
      labelCell.alignment = { horizontal: "center", vertical: "middle" };
    } else if (p.status === "pending") {
      const row = sheet.addRow([p.barcode ?? "", "Not Scanned", "—", "—", "—"]);
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
      });
      const labelCell = row.getCell(2);
      labelCell.font = { bold: true, italic: true };
    } else {
      const issueLabel = buildIssueLabel(reqMrp, reqBox, reqPcs, compMrp, compBox, compPcs);
      const row = sheet.addRow([p.barcode ?? "", issueLabel, compMrp, compBox, compPcs]);
      row.getCell(2).font = { bold: true };

      if (fieldDiff(compMrp, reqMrp) !== "match")
        row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      if (fieldDiff(compBox, reqBox) !== "match")
        row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      if (fieldDiff(compPcs, reqPcs) !== "match")
        row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    }

    sheet.addRow([]);
  }

  if (adminAdded.length > 0) {
    const secHeader = sheet.addRow(["", "Items Added by Admin", "", "", ""]);
    secHeader.getCell(2).font = { bold: true, italic: true };
    for (const p of adminAdded) {
      const row = sheet.addRow([
        p.barcode ?? "",
        p.product_name,
        p.completed_mrp ?? p.required_mrp ?? 0,
        p.completed_box ?? p.required_box ?? 0,
        p.completed_pcs ?? p.required_pcs ?? 0,
      ]);
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      });
    }
    sheet.addRow([]);
  }

  if (adminRemoved.length > 0) {
    const secHeader = sheet.addRow(["", "Items Removed by Admin", "", "", ""]);
    secHeader.getCell(2).font = { bold: true, italic: true };
    for (const p of adminRemoved) {
      const row = sheet.addRow([
        p.barcode ?? "",
        p.product_name,
        p.required_mrp ?? 0,
        p.required_box ?? 0,
        p.required_pcs ?? 0,
      ]);
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
      });
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `${safe(summary.title)}_Final_Report.xlsx`);
}

// ---------------- WORD (.docx) SUMMARY OF CHANGES ----------------

export async function downloadChangesSummary(summary: Summary, products: Product[]) {
  const changed = products.filter((p) => p.change_note && p.change_note.trim() !== "");

  const children: Paragraph[] = [
    new Paragraph({ text: `Mewar Distribution Centre`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      text: `Dispatch Summary Changes — ${summary.title}`,
      heading: HeadingLevel.HEADING_2,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Uploaded by: ${summary.uploaded_by}`, italics: true })],
    }),
    new Paragraph({ text: "" }),
  ];

  if (changed.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No changes were made to this dispatch. All items match the original summary.",
          }),
        ],
      }),
    );
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "The following changes/issues were found in this dispatch:", bold: true })],
      }),
      new Paragraph({ text: "" }),
    );

    for (const p of changed) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: `${p.product_name}: `, bold: true }),
            new TextRun({ text: p.change_note || "" }),
          ],
        }),
      );
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${safe(summary.title)}_Changes_Summary.docx`);
}
