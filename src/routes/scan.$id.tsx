import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Flag,
  Keyboard,
  Loader2,
  Search,
  ImagePlus,
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
import { computeStatus, supabase, type Product, type Summary } from "@/lib/supabase";
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

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [camera, setCamera] = useState(false);
  const [photoMatch, setPhotoMatch] = useState(false);
  const [active, setActive] = useState<Product | null>(null);
  const [readOnly, setReadOnly] = useState<Product | null>(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["scan", id],
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

  const modalOpen = camera || photoMatch || !!active || !!readOnly || confirmDone;

  const handleBarcode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const found = products.find((p) => (p.barcode ?? "").trim() === code);
      if (!found) {
        toast.error(`Barcode not in this summary: ${code}`);
        return;
      }
      if (found.status === "match") {
        setReadOnly(found);
        return;
      }
      setActive(found);
    },
    [products],
  );

  const handlePhotoSelect = useCallback((found: Product) => {
    setPhotoMatch(false);
    if (found.status === "match") {
      setReadOnly(found);
    } else {
      setActive(found);
    }
  }, []);

  // External USB / Bluetooth scanner: rapid keystrokes ending in Enter.
  useEffect(() => {
    if (modalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const now = Date.now();
      if (now - lastKeyRef.current > 120) bufferRef.current = "";
      lastKeyRef.current = now;
      if (e.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= 3) handleBarcode(code);
        return;
      }
      if (e.key.length === 1) bufferRef.current += e.key;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, handleBarcode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.product_name ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  function openProduct(p: Product) {
    if (p.status === "match") setReadOnly(p);
    else setActive(p);
  }

  function onSaved(updated: Product) {
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
    const { error: sErr } = await supabase.from("summaries").update({ status: "done" }).eq("id", id);
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
  if (error)
    return (
      <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error).message}
      </p>
    );

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
              <p className={`font-display text-lg font-semibold ${cls}`}>{value as number}</p>
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

      <div className="grid gap-2 sm:grid-cols-3">
        <Button variant="hero" size="lg" onClick={() => setCamera(true)}>
          <Camera className="h-5 w-5" /> Scan with Camera
        </Button>
        <Button variant="outline" size="lg" onClick={() => setPhotoMatch(true)}>
          <ImagePlus className="h-5 w-5" /> Match by Photo
        </Button>
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Keyboard className="h-4 w-4 text-primary" />
          USB / Bluetooth scanner ready — just scan
        </div>
      </div>

      <section className="surface-card space-y-3 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Search product name or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No matching products"
            description="Try another product name or barcode."
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => openProduct(p)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-secondary/40 active:scale-[0.995]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.product_name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {p.barcode} · Req {p.required_box ?? 0} Box / {p.required_pcs ?? 0} Pcs
                    </span>
                  </span>
                  <StatusBadge status={p.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {camera ? (
        <CameraScanner
          onClose={() => setCamera(false)}
          onDetected={(code) => {
            setCamera(false);
            handleBarcode(code);
          }}
        />
      ) : null}

      {photoMatch ? (
        <PhotoMatchScanner
          products={products}
          onClose={() => setPhotoMatch(false)}
          onSelect={handlePhotoSelect}
        />
      ) : null}

      {active ? (
        <ProductCard product={active} onCancel={() => setActive(null)} onSaved={onSaved} />
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
              <Button variant="hero" className="w-full" onClick={() => setReadOnly(null)}>
                Back
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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

function ReadRow({
  label,
  mrp,
  box,
  pcs,
}: {
  label: string;
  mrp: number | null;
  box: number | null;
  pcs: number | null;
}) {
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
            <p className="font-display text-base font-semibold">{v as string}</p>
            <p className="text-[11px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  onCancel,
  onSaved,
}: {
  product: Product;
  onCancel: () => void;
  onSaved: (p: Product) => void;
}) {
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
    onSaved(data as Product);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-left leading-snug">{product.product_name}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 font-mono text-xs text-muted-foreground">{product.barcode}</p>

        <ReadRow
          label="Required"
          mrp={product.required_mrp}
          box={product.required_box}
          pcs={product.required_pcs}
        />

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
