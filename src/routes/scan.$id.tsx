import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Barcode,
  Camera,
  CheckCircle2,
  Flag,
  Keyboard,
  Link2,
  Loader2,
  Search,
  ImagePlus,
  Image as ImageIcon,
  AlertCircle,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState, Spinner } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { CameraScanner } from "@/components/CameraScanner";
import { PhotoMatchScanner } from "@/components/PhotoMatchScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  computeStatus,
  findBestNameMatch,
  linkBarcodeToProduct,
  lookupBarcodeMaster,
  nameSimilarity,
  supabase,
} from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/scan/$id")({
  head: () => ({
    meta: [
      { title: "Scan & Verify | Mewar Distribution Centre" },
      {
        name: "description",
        content:
          "Scan dispatch barcodes with the camera or a USB scanner and record completed box and piece counts against the required quantities.",
      },
      { property: "og:title", content: "Scan & Verify | Mewar Distribution Centre" },
      {
        property: "og:description",
        content: "Scan barcodes and record completed counts against required quantities.",
      },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  return (
    <AppShell>
      <ScanScreen />
    </AppShell>
  );
}

function ScanScreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user && user.role !== "admin") {
      navigate({ to: "/" });
    }
  }, [user, navigate]);

  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [viewFilter, setViewFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // cameraMode: null | "verify" (normal barcode-summary scanning) |
  // "master" (Scan Barcode quick action -> master lookup) |
  // "productLink" (scan-to-link from inside the edit dialog)
  const [cameraMode, setCameraMode] = useState(null);

  const [photoMatch, setPhotoMatch] = useState(false);
  const [photoGallery, setPhotoGallery] = useState(false);
  const [active, setActive] = useState(null);
  const [readOnly, setReadOnly] = useState(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [flash, setFlash] = useState(null);
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);
  const lastAutoOpenedRef = useRef(null);

  // "Item not in data" assign flow — when a scanned barcode isn't linked
  // to anything (or doesn't fuzzy-match anything in this summary).
  const [assignFlow, setAssignFlow] = useState(null); // { barcode, suggestedName }

  // Conflict warning — when scan-to-link (from ProductCard) hits a
  // barcode already linked to a different product name.
  const [linkConflict, setLinkConflict] = useState(null); // { barcode, existingName, productId, productName }
  const [linkTargetProduct, setLinkTargetProduct] = useState(null);
  const [barcodeMultiMatch, setBarcodeMultiMatch] = useState(null); // { code, matches }
  const routeScanRef = useRef(() => {});

  const { data, isLoading, error } = useQuery({
    queryKey: ["scan", id],
    queryFn: async () => {
      const [s, p] = await Promise.all([
        supabase.from("summaries").select("*").eq("id", id).maybeSingle(),
        supabase.from("products").select("*").eq("summary_id", id).order("created_at"),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      if (!s.data) throw new Error("SUMMARY_NOT_FOUND");
      return { summary: s.data, products: p.data ?? [] };
    },
  });

  useEffect(() => {
    if (data?.products) setProducts(data.products);
  }, [data]);

  const counts = useMemo(() => {
    const c = { match: 0, short: 0, excess: 0, pending: 0 };
    for (const p of products) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [products]);
  const total = products.length;
  const completed = total - counts.pending;
  const progress = total ? Math.round((completed / total) * 100) : 0;

  const photoOnly = products.length > 0 && products.every((p) => !(p.barcode ?? "").trim());

  const modalOpen =
    cameraMode !== null ||
    photoMatch ||
    photoGallery ||
    !!active ||
    !!readOnly ||
    confirmDone ||
    showAdd ||
    !!deleteTarget ||
    !!assignFlow ||
    !!linkConflict ||
    !!barcodeMultiMatch;

  const handleBarcode = useCallback(
    (raw) => {
      const code = raw.trim();
      if (!code) return;
      const matches = products.filter(
        (p) => (p.barcode ?? "").trim() === code && p.status !== "removed",
      );
      if (matches.length === 0) {
        toast.error(`Barcode not in this summary: ${code}`);
        return;
      }
      if (matches.length > 1) {
        setBarcodeMultiMatch({ code, matches });
        return;
      }
      const found = matches[0];
      if (found.status === "match") {
        setReadOnly(found);
        return;
      }
      setActive(found);
    },
    [products],
  );

  const handlePhotoSelect = useCallback((found) => {
    setPhotoMatch(false);
    setPhotoGallery(false);
    if (found.status === "match") {
      setReadOnly(found);
    } else {
      setActive(found);
    }
  }, []);

  // ---- Master barcode scan (used by both camera AND physical scanner) ----
  async function performMasterScan(code) {
    try {
      const existing = await lookupBarcodeMaster(code);
      if (existing) {
        const match = findBestNameMatch(products, existing.product_name);
        if (match) {
          if (match.status === "match") setReadOnly(match);
          else setActive(match);
          return;
        }
      }
      setAssignFlow({ barcode: code, suggestedName: existing?.product_name ?? "" });
    } catch (e) {
      toast.error(`Lookup failed: ${e.message ?? e}`);
    }
  }

  async function handleMasterScan(code) {
    setCameraMode(null);
    await performMasterScan(code);
  }

  // ---- Scan-to-link (used by both camera AND physical scanner) ----
  async function performProductLink(code, target) {
    if (!target) return;
    try {
      const existing = await lookupBarcodeMaster(code);
      if (existing) {
        const same = nameSimilarity(existing.product_name, target.product_name ?? "") >= 0.7;
        if (!same) {
          setLinkConflict({
            barcode: code,
            existingName: existing.product_name,
            productId: target.id,
            productName: target.product_name ?? "",
          });
          return;
        }
      }
      await linkBarcodeToProduct(code, target.product_name ?? "");
      toast.success(`Barcode linked to "${target.product_name}"`);
    } catch (e) {
      toast.error(`Could not link barcode: ${e.message ?? e}`);
    }
  }

  async function handleProductLinkScan(code) {
    setCameraMode(null);
    const target = linkTargetProduct;
    await performProductLink(code, target);
    setActive(target);
    setLinkTargetProduct(null);
  }

  // Physical (USB/Bluetooth) scanner routing — decides what a raw scanned
  // code should do based on what's currently open, without ever needing
  // the camera UI at all.
  useEffect(() => {
    routeScanRef.current = function (code) {
      const trimmed = code.trim();
      if (!trimmed) return;
      if (linkConflict || assignFlow || confirmDone || showAdd || deleteTarget || photoMatch || photoGallery || readOnly) {
        return;
      }
      if (active) {
        if (!active.barcode) performProductLink(trimmed, active);
        return;
      }
      if (photoOnly) {
        performMasterScan(trimmed);
        return;
      }
      handleBarcode(trimmed);
    };
  });

  async function confirmChangeLink() {
    if (!linkConflict) return;
    try {
      await linkBarcodeToProduct(linkConflict.barcode, linkConflict.productName);
      toast.success(`Barcode re-linked to "${linkConflict.productName}"`);
    } catch (e) {
      toast.error(`Could not change link: ${e.message ?? e}`);
    } finally {
      setLinkConflict(null);
    }
  }

  // "Remove Previous" — clears the barcode from every OTHER item sharing
  // it, so this barcode becomes uniquely reserved for the chosen item.
  async function keepBarcodeForOnly(item, allMatches) {
    const others = allMatches.filter((p) => p.id !== item.id);
    try {
      const { error } = await supabase
        .from("products")
        .update({ barcode: null })
        .in("id", others.map((p) => p.id));
      if (error) throw error;
      setProducts((prev) =>
        prev.map((p) => (others.some((o) => o.id === p.id) ? { ...p, barcode: null } : p)),
      );
      toast.success(`Barcode kept only for "${item.product_name}"`);
    } catch (e) {
      toast.error(`Could not update: ${e.message ?? e}`);
    } finally {
      setBarcodeMultiMatch(null);
      openProduct(item);
    }
  }

  useEffect(() => {
    function onKeyDown(e) {
      const target = e.target;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      // Camera modes handle their own detection — don't double-fire.
      if (cameraMode !== null) return;
      const now = Date.now();
      if (now - lastKeyRef.current > 120) bufferRef.current = "";
      lastKeyRef.current = now;
      if (e.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= 3) routeScanRef.current(code);
        return;
      }
      if (e.key.length === 1) bufferRef.current += e.key;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cameraMode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;

    const tokens = q.split(/\s+/).filter(Boolean);
    const prefix = tokens[0];
    const restTokens = tokens.slice(1);
    const numericTokens = restTokens.filter((t) => /^\d+(\.\d+)?$/.test(t));
    const textTokens = restTokens.filter((t) => !/^\d+(\.\d+)?$/.test(t));

    const base = products.filter((p) => {
      const name = (p.product_name ?? "").toLowerCase();
      const barcode = (p.barcode ?? "").toLowerCase();

      if (barcode && barcode.startsWith(q)) return true;

      if (!name.startsWith(prefix)) return false;
      for (const t of textTokens) {
        if (!name.includes(t)) return false;
      }
      return true;
    });

    if (numericTokens.length === 0) return base;

    const target = Number(numericTokens[numericTokens.length - 1]);
    function mrpDistance(p) {
      if (p.required_mrp == null) return Infinity;
      return Math.abs(p.required_mrp - target);
    }

    return [...base].sort((a, b) => mrpDistance(a) - mrpDistance(b));
  }, [products, search]);

  function isMrpMismatch(p) {
    return p.status === "match" && (p.completed_mrp ?? p.required_mrp ?? 0) !== (p.required_mrp ?? 0);
  }
  function issueRank(p) {
    if (p.status === "short" || p.status === "excess") return 0;
    if (isMrpMismatch(p)) return 1;
    if (p.status === "pending") return 2;
    if (p.status === "removed") return 3;
    return 4;
  }

  const visibleProducts = useMemo(() => {
    if (viewFilter === "all") return filtered;
    if (viewFilter === "issues_first") return [...filtered].sort((a, b) => issueRank(a) - issueRank(b));
    if (viewFilter === "short") return filtered.filter((p) => p.status === "short");
    if (viewFilter === "excess") return filtered.filter((p) => p.status === "excess");
    if (viewFilter === "mrp") return filtered.filter((p) => isMrpMismatch(p));
    if (viewFilter === "pending") return filtered.filter((p) => p.status === "pending");
    if (viewFilter === "correct") return filtered.filter((p) => p.status === "match" && !isMrpMismatch(p));
    return filtered;
  }, [filtered, viewFilter]);

  async function deleteProduct() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from("products")
      .update({ status: "removed", change_note: "Removed by Admin" })
      .eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
      return;
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === deleteTarget.id ? { ...p, status: "removed", change_note: "Removed by Admin" } : p)),
    );
    toast.success("Item removed");
    setDeleteTarget(null);
  }

  useEffect(() => {
    if (!search.trim() || filtered.length !== 1 || modalOpen) {
      if (filtered.length !== 1) lastAutoOpenedRef.current = null;
      return;
    }
    const p = filtered[0];
    if (lastAutoOpenedRef.current === p.id) return;
    lastAutoOpenedRef.current = p.id;
    openProduct(p);
  }, [filtered, search, modalOpen]);

  function openProduct(p) {
    if (p.status === "match") setReadOnly(p);
    else setActive(p);
  }

  function onSaved(updated) {
    const next = products.map((p) => (p.id === updated.id ? updated : p));
    setProducts(next);
    setActive(null);
    const pending = next.filter((p) => p.status === "pending").length;
    const msg = `Completed: ${next.length - pending} items | Pending: ${pending} items`;
    setFlash(msg);
    toast.success(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  async function finish() {
    setFinishing(true);
    const pendingIds = products.filter((p) => p.status === "pending").map((p) => p.id);
    if (pendingIds.length) {
      const { error: nErr } = await supabase
        .from("products")
        .update({ change_note: "Not Scanned" })
        .in("id", pendingIds);
      if (nErr) {
        setFinishing(false);
        toast.error(`Could not mark unscanned items: ${nErr.message}`);
        return;
      }
    }
    const { error: sErr } = await supabase
      .from("summaries")
      .update({ status: "done", finalized_at: new Date().toISOString() })
      .eq("id", id);
    setFinishing(false);
    if (sErr) {
      toast.error(`Could not finalize summary: ${sErr.message}`);
      return;
    }
    setConfirmDone(false);
    toast.success("Verification finalized");
    navigate({ to: "/report/$id", params: { id } });
  }

  if (isLoading) return <Spinner label="Loading dispatch..." />;

  if (error) {
    const isNotFound = error.message === "SUMMARY_NOT_FOUND";
    return (
      <EmptyState
        icon={<AlertCircle className="h-6 w-6" />}
        title={isNotFound ? "This summary no longer exists" : "Something went wrong"}
        description={
          isNotFound
            ? "It may have been deleted. Please go back to the dashboard and pick a summary from the list."
            : error.message
        }
        action={
          <Button variant="hero" onClick={() => navigate({ to: "/" })}>
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <Button variant="gold" size="sm" onClick={() => setConfirmDone(true)}>
          <Flag className="h-4 w-4" /> Done
        </Button>
      </div>

      <section className="surface-card sticky top-16 z-20 space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="truncate font-display text-lg font-semibold">{data?.summary.title}</h1>
          <span className="shrink-0 text-sm font-semibold text-primary">
            {completed} / {total}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-[image:var(--gradient-brand)] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {completed} Completed / {counts.pending} Pending
        </p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["Match", counts.match, "text-success"],
            ["Short", counts.short, "text-destructive"],
            ["Excess", counts.excess, "text-warning-foreground"],
            ["Pending", counts.pending, "text-muted-foreground"],
          ].map(([label, value, cls]) => (
            <div key={String(label)} className="rounded-xl bg-secondary/70 px-2 py-2">
              <p className={`font-display text-lg font-semibold ${cls}`}>{value}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        {flash ? (
          <p className="animate-fade-in rounded-lg bg-success/12 px-3 py-2 text-sm font-medium text-success">
            {flash}
          </p>
        ) : null}
      </section>

      {photoOnly ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="hero" size="lg" onClick={() => setPhotoMatch(true)}>
            <ImagePlus className="h-5 w-5" /> Match by Photo
          </Button>
          <Button variant="outline" size="lg" onClick={() => setPhotoGallery(true)}>
            <ImageIcon className="h-5 w-5" /> Upload from Gallery
          </Button>
          <Button variant="outline" size="lg" onClick={() => setCameraMode("master")}>
            <Barcode className="h-5 w-5" /> Scan Barcode
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="hero" size="lg" onClick={() => setCameraMode("verify")}>
            <Camera className="h-5 w-5" /> Scan with Camera
          </Button>
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <Keyboard className="h-4 w-4 text-primary" />
            USB / Bluetooth scanner ready — just scan
          </div>
        </div>
      )}

      <section className="surface-card space-y-3 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Search Product (Example: cl, cl 1)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={viewFilter}
            onChange={(e) => setViewFilter(e.target.value)}
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All Items</option>
            <option value="issues_first">Issues First</option>
            <option value="short">Short Only</option>
            <option value="excess">Excess Only</option>
            <option value="mrp">MRP Mismatch Only</option>
            <option value="pending">Not Scanned Only</option>
            <option value="correct">Correct Only</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            <PlusCircle className="h-4 w-4" /> Add Item
          </Button>
        </div>

        {visibleProducts.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No matching products"
            description="Try another product name, barcode, or filter."
          />
        ) : (
          <ul className="divide-y divide-border">
            {visibleProducts.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openProduct(p)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-secondary/40 active:scale-[0.995]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.product_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {photoOnly ? "" : `${p.barcode} • `}
                      MRP ₹{p.required_mrp ?? "-"} • {p.required_box ?? 0} Box •{" "}
                      {p.required_pcs ?? 0} Pcs
                    </span>
                  </span>
                  <StatusBadge
                    status={p.status}
                    mrpMismatch={(p.completed_mrp ?? p.required_mrp ?? 0) !== (p.required_mrp ?? 0)}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(p)}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Delete item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cameraMode === "verify" ? (
        <CameraScanner
          onClose={() => setCameraMode(null)}
          onDetected={(code) => {
            setCameraMode(null);
            handleBarcode(code);
          }}
        />
      ) : null}

      {cameraMode === "master" ? (
        <CameraScanner onClose={() => setCameraMode(null)} onDetected={handleMasterScan} />
      ) : null}

      {cameraMode === "productLink" ? (
        <CameraScanner
          onClose={() => {
            setCameraMode(null);
            setActive(linkTargetProduct);
            setLinkTargetProduct(null);
          }}
          onDetected={handleProductLinkScan}
        />
      ) : null}

      {photoMatch ? (
        <PhotoMatchScanner
          mode="camera"
          products={products}
          onClose={() => setPhotoMatch(false)}
          onSelect={handlePhotoSelect}
        />
      ) : null}

      {photoGallery ? (
        <PhotoMatchScanner
          mode="gallery"
          products={products}
          onClose={() => setPhotoGallery(false)}
          onSelect={handlePhotoSelect}
        />
      ) : null}

      {active ? (
        <ProductCard
          product={active}
          onCancel={() => setActive(null)}
          onSaved={onSaved}
          onRequestScanLink={() => {
            setLinkTargetProduct(active);
            setActive(null);
            setCameraMode("productLink");
          }}
        />
      ) : null}

      <Dialog open={!!readOnly} onOpenChange={(o) => !o && setReadOnly(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> This item is already complete
            </DialogTitle>
          </DialogHeader>
          {readOnly ? (
            <div className="space-y-3">
              <div>
                <p className="font-medium">{readOnly.product_name}</p>
                <p className="font-mono text-xs text-muted-foreground">{readOnly.barcode}</p>
              </div>
              <ReadRow
                label="Required"
                mrp={readOnly.required_mrp}
                box={readOnly.required_box}
                pcs={readOnly.required_pcs}
              />
              <ReadRow
                label="Completed"
                mrp={readOnly.completed_mrp}
                box={readOnly.completed_box}
                pcs={readOnly.completed_pcs}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const p = readOnly;
                    setReadOnly(null);
                    setActive(p);
                  }}
                >
                  Edit
                </Button>
                <Button variant="hero" className="flex-1" onClick={() => setReadOnly(null)}>
                  Back
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {showAdd ? (
        <AddItemDialog
          summaryId={id}
          onClose={() => setShowAdd(false)}
          onAdded={(p) => {
            setProducts((prev) => [...prev, p]);
            setShowAdd(false);
          }}
        />
      ) : null}

      {assignFlow ? (
        <AssignFlowDialog
          barcode={assignFlow.barcode}
          suggestedName={assignFlow.suggestedName}
          products={products}
          onClose={() => setAssignFlow(null)}
          onAssigned={(p) => {
            setAssignFlow(null);
            openProduct(p);
          }}
        />
      ) : null}

      {barcodeMultiMatch ? (
        <BarcodeMultiMatchDialog
          code={barcodeMultiMatch.code}
          matches={barcodeMultiMatch.matches}
          onClose={() => setBarcodeMultiMatch(null)}
          onOpenItem={(p) => {
            setBarcodeMultiMatch(null);
            openProduct(p);
          }}
          onKeepOnly={(p) => keepBarcodeForOnly(p, barcodeMultiMatch.matches)}
        />
      ) : null}

      <AlertDialog open={!!linkConflict} onOpenChange={(o) => !o && setLinkConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Barcode already linked</AlertDialogTitle>
            <AlertDialogDescription>
              This barcode is currently linked to "{linkConflict?.existingName}". Change the link so it
              points to "{linkConflict?.productName}" instead? The old link will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmChangeLink();
              }}
            >
              <Link2 className="h-4 w-4" /> Change Link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.product_name} will be marked as removed and shown in the "Items Removed by Admin"
              section of the final report.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                deleteProduct();
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDone} onOpenChange={(o) => !finishing && setConfirmDone(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this dispatch?</AlertDialogTitle>
            <AlertDialogDescription>
              Match: {counts.match} · Short: {counts.short} · Excess: {counts.excess} · Pending:{" "}
              {counts.pending}. Pending items will be marked "Not Scanned".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={finishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={finishing}
              onClick={(e) => {
                e.preventDefault();
                finish();
              }}
            >
              {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Finalize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ReadRow({ label, mrp, box, pcs }) {
  return (
    <div className="rounded-xl bg-secondary/70 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["MRP", mrp === null ? "—" : `₹${mrp}`],
          ["Box", box ?? "—"],
          ["Pcs", pcs ?? "—"],
        ].map(([l, v]) => (
          <div key={String(l)}>
            <p className="font-display text-base font-semibold">{v}</p>
            <p className="text-[11px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddItemDialog({ summaryId, onClose, onAdded }) {
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [mrp, setMrp] = useState("");
  const [box, setBox] = useState("");
  const [pcs, setPcs] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Please enter a product name");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("products")
      .insert({
        summary_id: summaryId,
        barcode: barcode.trim() || null,
        product_name: name.trim(),
        required_mrp: Number(mrp) || 0,
        required_box: Number(box) || 0,
        required_pcs: Number(pcs) || 0,
        status: "pending",
        change_note: "Added by Admin",
      })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(`Could not add item: ${error?.message ?? "unknown error"}`);
      return;
    }
    toast.success("Item added");
    onAdded(data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="add-name" className="text-xs">Product Name</Label>
            <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lux Soap 100G" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-barcode" className="text-xs">Barcode (optional)</Label>
            <Input id="add-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="add-mrp" className="text-xs">MRP</Label>
              <Input id="add-mrp" inputMode="decimal" value={mrp} onChange={(e) => setMrp(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-box" className="text-xs">Box</Label>
              <Input id="add-box" inputMode="numeric" value={box} onChange={(e) => setBox(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-pcs" className="text-xs">Pcs</Label>
              <Input id="add-pcs" inputMode="numeric" value={pcs} onChange={(e) => setPcs(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="hero" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add Item
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Shown when a scanned barcode is either brand-new, or already linked to
// a name that doesn't fuzzy-match anything in THIS summary. User picks
// the right product manually and assigns the scan to it permanently.
function AssignFlowDialog({ barcode, suggestedName, products, onClose, onAssigned }) {
  const [query, setQuery] = useState(suggestedName || "");
  const [assigning, setAssigning] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 30);
    return products.filter((p) => (p.product_name ?? "").toLowerCase().includes(q)).slice(0, 30);
  }, [products, query]);

  async function assignTo(p) {
    setAssigning(true);
    try {
      await linkBarcodeToProduct(barcode, p.product_name ?? "");
      toast.success(`Barcode assigned to "${p.product_name}"`);
      onAssigned(p);
    } catch (e) {
      toast.error(`Could not assign: ${e.message ?? e}`);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !assigning && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Item not in data</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-secondary/70 px-3 py-2 font-mono text-xs text-muted-foreground">
            Scanned: {barcode}
          </p>
          {suggestedName ? (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              This barcode was last linked to: <span className="font-semibold">{suggestedName}</span>. Pick
              the matching product below to (re)assign it.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              This barcode hasn't been linked to any product yet. Search and select the correct product
              below to link it permanently.
            </p>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="h-11 pl-9"
              placeholder="Search product name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No products match.</p>
            ) : (
              results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={assigning}
                  onClick={() => assignTo(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/50 active:scale-[0.99] disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.product_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      Req {p.required_box ?? 0} Box / {p.required_pcs ?? 0} Pcs
                    </span>
                  </span>
                  <Link2 className="h-5 w-5 shrink-0 text-primary" />
                </button>
              ))
            )}
          </div>
          <Button variant="outline" className="w-full" onClick={onClose} disabled={assigning}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Shown when a scanned barcode matches MORE THAN ONE item in this summary
// (duplicate/shared barcode across different priced variants).
function BarcodeMultiMatchDialog({ code, matches, onClose, onOpenItem, onKeepOnly }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Multiple items use this barcode</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-secondary/70 px-3 py-2 font-mono text-xs text-muted-foreground">
            Scanned: {code}
          </p>
          <p className="text-xs text-muted-foreground">
            {matches.length} items share this barcode. Tap one to open it (barcode stays shared — "Add
            Multiple"), or use "Remove Previous" to keep the barcode only for that item going forward.
          </p>
          <div className="space-y-2">
            {matches.map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-card p-3">
                <button
                  type="button"
                  onClick={() => onOpenItem(p)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.product_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      MRP ₹{p.required_mrp ?? "-"} • {p.required_box ?? 0} Box / {p.required_pcs ?? 0} Pcs
                    </span>
                  </span>
                  <StatusBadge status={p.status} mrpMismatch={false} />
                </button>
                <button
                  type="button"
                  onClick={() => onKeepOnly(p)}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  Remove Previous — keep barcode only for this item
                </button>
              </div>
            ))}
          </div>
          <Button variant="outline" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductCard({ product, onCancel, onSaved, onRequestScanLink }) {
  const [mrp, setMrp] = useState(String(product.completed_mrp ?? product.required_mrp ?? ""));
  const [box, setBox] = useState(product.completed_box === null ? "" : String(product.completed_box));
  const [pcs, setPcs] = useState(product.completed_pcs === null ? "" : String(product.completed_pcs));
  const [saving, setSaving] = useState(false);

  async function save() {
    const cBox = Number(box) || 0;
    const cPcs = Number(pcs) || 0;
    const cMrp = Number(mrp) || 0;
    const status = computeStatus(product.required_box ?? 0, product.required_pcs ?? 0, cBox, cPcs);
    setSaving(true);
    const { data, error } = await supabase
      .from("products")
      .update({ completed_mrp: cMrp, completed_box: cBox, completed_pcs: cPcs, status })
      .eq("id", product.id)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(`Could not save: ${error?.message ?? "unknown error"}`);
      return;
    }
    onSaved(data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-left leading-snug">{product.product_name}</DialogTitle>
        </DialogHeader>
        {product.barcode ? (
          <p className="-mt-2 font-mono text-xs text-muted-foreground">{product.barcode}</p>
        ) : null}

        <ReadRow
          label="Required"
          mrp={product.required_mrp}
          box={product.required_box}
          pcs={product.required_pcs}
        />

        {!product.barcode ? (
          <Button variant="outline" className="w-full" onClick={onRequestScanLink}>
            <Barcode className="h-4 w-4" /> Scan Barcode & Link to This Product
          </Button>
        ) : null}

        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
            Completed
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="scan-mrp" className="text-xs">MRP</Label>
              <Input
                id="scan-mrp"
                inputMode="decimal"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scan-box" className="text-xs">Box</Label>
              <Input
                id="scan-box"
                inputMode="numeric"
                autoFocus
                placeholder="0"
                value={box}
                onChange={(e) => setBox(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scan-pcs" className="text-xs">Pcs</Label>
              <Input
                id="scan-pcs"
                inputMode="numeric"
                placeholder="0"
                value={pcs}
                onChange={(e) => setPcs(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="hero" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
