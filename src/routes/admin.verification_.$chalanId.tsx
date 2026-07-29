import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  supabase,
  type Chalan,
  type BillItem,
  type ShopVerification,
  type VerificationItem,
} from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/verification/$chalanId")({
  component: () => (
    <AppShell>
      <ShopVerifyScreen />
    </AppShell>
  ),
});

function ShopVerifyScreen() {
  const { chalanId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [totalCases, setTotalCases] = useState("");
  const [totalPieces, setTotalPieces] = useState("");
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["shop-verify", chalanId],
    queryFn: async () => {
      const chalanRes = await supabase.from("chalans").select("*").eq("id", chalanId).maybeSingle();
      if (chalanRes.error) throw chalanRes.error;
      if (!chalanRes.data) throw new Error("CHALAN_NOT_FOUND");
      const chalan = chalanRes.data as Chalan;

      let billItems: BillItem[] = [];
      if (chalan.bill_id) {
        const itemsRes = await supabase
          .from("bill_items")
          .select("*")
          .eq("bill_id", chalan.bill_id)
          .order("created_at");
        if (itemsRes.error) throw itemsRes.error;
        billItems = (itemsRes.data ?? []) as BillItem[];
      }

      // Get or create the shop_verification row for this chalan
      let verification: ShopVerification;
      const existingVerify = await supabase
        .from("shop_verification")
        .select("*")
        .eq("chalan_id", chalanId)
        .maybeSingle();

      if (existingVerify.data) {
        verification = existingVerify.data as ShopVerification;
      } else {
        const created = await supabase
          .from("shop_verification")
          .insert({ chalan_id: chalanId, verified_by: user?.id ?? null })
          .select()
          .single();
        if (created.error) throw created.error;
        verification = created.data as ShopVerification;
      }

      // Get or create verification_items to mirror bill_items
      const existingItems = await supabase
        .from("verification_items")
        .select("*")
        .eq("shop_verification_id", verification.id)
        .order("created_at");
      if (existingItems.error) throw existingItems.error;

      let verifItems = (existingItems.data ?? []) as VerificationItem[];
      if (verifItems.length === 0 && billItems.length > 0) {
        const inserted = await supabase
          .from("verification_items")
          .insert(
            billItems.map((it) => ({
              shop_verification_id: verification.id,
              bill_item_id: it.id,
              product_name: it.product_name,
              expected_cases: it.cases,
              expected_pieces: it.pieces,
            }))
          )
          .select();
        if (inserted.error) throw inserted.error;
        verifItems = (inserted.data ?? []) as VerificationItem[];
      }

      return { chalan, verification, verifItems };
    },
  });

  useEffect(() => {
    if (data) {
      setItems(data.verifItems);
      setTotalCases(data.verification.total_cases?.toString() ?? "");
      setTotalPieces(data.verification.total_pieces?.toString() ?? "");
    }
  }, [data]);

  const allChecked = useMemo(() => items.length > 0 && items.every((it) => it.is_checked), [items]);

  async function toggleItem(item: VerificationItem) {
    const next = !item.is_checked;
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_checked: next } : it)));
    const { error } = await supabase.from("verification_items").update({ is_checked: next }).eq("id", item.id);
    if (error) {
      toast.error(`Could not save: ${error.message}`);
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_checked: !next } : it)));
    }
  }

  async function approve() {
    if (!data) return;
    if (!allChecked) {
      toast.error("Please tick every item before approving");
      return;
    }
    const cCases = Number(totalCases) || 0;
    const cPieces = Number(totalPieces) || 0;
    const expectedCases = items.reduce((s, it) => s + it.expected_cases, 0);
    const expectedPieces = items.reduce((s, it) => s + it.expected_pieces, 0);
    const verificationStatus = cCases === expectedCases && cPieces === expectedPieces ? "match" : "mismatch";

    setApproving(true);
    const vErr = await supabase
      .from("shop_verification")
      .update({
        total_cases: cCases,
        total_pieces: cPieces,
        verification_status: verificationStatus,
        verified_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.verification.id);

    const cErr = await supabase.from("chalans").update({ status: "verified" }).eq("id", chalanId);
    setApproving(false);

    if (vErr.error || cErr.error) {
      toast.error(`Could not save approval: ${(vErr.error ?? cErr.error)?.message}`);
      return;
    }
    toast.success(`Verification saved as ${verificationStatus === "match" ? "Match" : "Mismatch"}`);
    refetch();
    navigate({ to: "/admin/verification" });
  }

  if (isLoading) return <Spinner label="Loading shop items..." />;

  if (!data) {
    return (
      <EmptyState
        icon={<PackageCheck className="h-6 w-6" />}
        title="Shop not found"
        description="This chalan may have been deleted."
        action={
          <Button variant="hero" onClick={() => navigate({ to: "/admin/verification" })}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />
    );
  }

  const { chalan } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/verification" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Verification Dashboard
        </Button>
      </div>

      <section className="surface-card space-y-1 p-4">
        <h1 className="font-display text-lg font-semibold">{chalan.party_name}</h1>
        <p className="text-sm text-muted-foreground">
          {chalan.owner_name ?? "—"} · Bill {chalan.bill_number} · ₹{chalan.bill_value}
        </p>
      </section>

      {items.length === 0 ? (
        <EmptyState
          icon={<PackageCheck className="h-6 w-6" />}
          title="No items found"
          description="This bill has no product line items, or it wasn't matched to a bill yet."
        />
      ) : (
        <section className="surface-card space-y-1 p-4">
          <p className="mb-2 text-sm font-semibold">Verify each item</p>
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => toggleItem(it)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-secondary/40 active:scale-[0.995]"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      it.is_checked ? "border-success bg-success text-white" : "border-border"
                    }`}
                  >
                    {it.is_checked ? <CheckCircle2 className="h-4 w-4" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block font-medium ${it.is_checked ? "text-muted-foreground line-through" : ""}`}>
                      {it.product_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {it.expected_cases} Case{it.expected_cases !== 1 ? "s" : ""} · {it.expected_pieces} Pcs
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface-card space-y-3 p-4">
        <p className="text-sm font-semibold">Actual dispatched quantity</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="tot-cases" className="text-xs">Total Cases</Label>
            <Input
              id="tot-cases"
              inputMode="decimal"
              placeholder="0"
              value={totalCases}
              onChange={(e) => setTotalCases(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tot-pieces" className="text-xs">Total Pieces</Label>
            <Input
              id="tot-pieces"
              inputMode="decimal"
              placeholder="0"
              value={totalPieces}
              onChange={(e) => setTotalPieces(e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        {!allChecked ? (
          <p className="text-xs text-warning-foreground">Tick every item above before approving.</p>
        ) : null}
        <Button variant="hero" className="w-full" onClick={approve} disabled={approving || !allChecked}>
          {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Approve
        </Button>
      </section>
    </div>
  );
}
