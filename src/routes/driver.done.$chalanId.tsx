import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ImagePlus, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, type Chalan } from "@/lib/supabase";

export const Route = createFileRoute("/driver/done/$chalanId")({
  component: () => (
    <AppShell>
      <DoneScreen />
    </AppShell>
  ),
});

const DEFAULT_DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

function DoneScreen() {
  const { chalanId } = useParams({ from: "/driver/done/$chalanId" });
  const navigate = useNavigate();

  const { data: chalan, isLoading } = useQuery({
    queryKey: ["chalan-detail", chalanId],
    queryFn: async () => {
      const { data, error } = await supabase.from("chalans").select("*").eq("id", chalanId).single();
      if (error) throw error;
      return data as Chalan;
    },
  });

  const [amountReceived, setAmountReceived] = useState("");
  const [paymentType, setPaymentType] = useState<"cash" | "online" | "cheque" | "">("");
  const [denoms, setDenoms] = useState<Record<string, string>>(
    Object.fromEntries(DEFAULT_DENOMS.map((d) => [String(d), ""]))
  );
  const [customDenoms, setCustomDenoms] = useState<{ label: string; qty: string }[]>([]);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const denomTotal =
    DEFAULT_DENOMS.reduce((sum, d) => sum + d * (Number(denoms[String(d)]) || 0), 0) +
    customDenoms.reduce((sum, c) => {
      const value = Number(c.label) || 0;
      const qty = Number(c.qty) || 0;
      return sum + value * qty;
    }, 0);

  const receivedNum = Number(amountReceived) || 0;
  const mismatch = paymentType === "cash" && amountReceived && Math.abs(denomTotal - receivedNum) > 0.01;

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoBase64(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function saveAndMarkDone() {
    if (!paymentType) {
      toast.error("Please select a payment type");
      return;
    }
    if (!amountReceived) {
      toast.error("Please enter amount received");
      return;
    }
    if ((paymentType === "online" || paymentType === "cheque") && !photoBase64) {
      toast.error(`Please upload the ${paymentType === "online" ? "payment screenshot" : "cheque photo"}`);
      return;
    }

    setSaving(true);
    try {
      const denominationsPayload =
        paymentType === "cash"
          ? {
              ...Object.fromEntries(
                DEFAULT_DENOMS.filter((d) => Number(denoms[String(d)]) > 0).map((d) => [
                  String(d),
                  Number(denoms[String(d)]),
                ])
              ),
              ...Object.fromEntries(
                customDenoms.filter((c) => c.label && Number(c.qty) > 0).map((c) => [c.label, Number(c.qty)])
              ),
            }
          : null;

      const { error } = await supabase
        .from("chalans")
        .update({
          amount_received: receivedNum,
          payment_type: paymentType,
          cash_denominations: denominationsPayload,
          payment_photo_url: paymentType !== "cash" ? photoBase64 : null,
          delivery_status: "completed",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", chalanId);
      if (error) throw error;

      toast.success("Marked as completed");
      navigate({ to: "/driver/dashboard" });
    } catch (err: any) {
      toast.error(`Could not save: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !chalan) return <Spinner label="Loading shop details..." />;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/driver/dashboard" })} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      <div className="surface-card space-y-1 p-4">
        <h1 className="font-display text-lg font-semibold">{chalan.party_name}</h1>
        <p className="text-sm text-muted-foreground">
          Bill {chalan.bill_number} · Bill Amount ₹{chalan.bill_value}
        </p>
      </div>

      <section className="surface-card space-y-4 p-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Amount Received
          </label>
          <Input
            inputMode="decimal"
            placeholder="e.g. 9244"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            className="h-11"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Payment Type
          </label>
          <select
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value as any)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select payment type</option>
            <option value="cash">Cash</option>
            <option value="online">Online</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>

        {paymentType === "cash" ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cash Denominations
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEFAULT_DENOMS.map((d) => (
                <div key={d} className="space-y-1">
                  <label className="text-xs text-muted-foreground">₹{d}</label>
                  <Input
                    inputMode="numeric"
                    placeholder="0"
                    value={denoms[String(d)]}
                    onChange={(e) => setDenoms((prev) => ({ ...prev, [String(d)]: e.target.value }))}
                    className="h-10"
                  />
                </div>
              ))}
            </div>

            {customDenoms.map((c, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Denomination (e.g. 2000)"
                  value={c.label}
                  onChange={(e) =>
                    setCustomDenoms((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
                  }
                  className="h-10"
                />
                <Input
                  inputMode="numeric"
                  placeholder="Qty"
                  value={c.qty}
                  onChange={(e) =>
                    setCustomDenoms((prev) => prev.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)))
                  }
                  className="h-10"
                />
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCustomDenoms((prev) => [...prev, { label: "", qty: "" }])}
            >
              <Plus className="h-4 w-4" /> Add More
            </Button>

            <div className="rounded-lg bg-secondary/50 p-3 text-sm">
              <p>Denomination Total: ₹{denomTotal}</p>
              {mismatch ? (
                <p className="mt-1 flex items-center gap-1 text-warning-foreground">
                  <AlertTriangle className="h-4 w-4" /> This doesn't match Amount Received (₹{receivedNum}). You can still proceed.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {paymentType === "online" || paymentType === "cheque" ? (
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {paymentType === "online" ? "Payment Screenshot" : "Cheque Photo"}
            </label>
            <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input text-sm text-muted-foreground">
              {photoBase64 ? (
                <img src={photoBase64} alt="preview" className="h-full w-full rounded-lg object-contain" />
              ) : (
                <>
                  <ImagePlus className="h-6 w-6" /> Tap to upload photo
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={onPhotoChange} />
            </label>
          </div>
        ) : null}

        <Button variant="hero" className="w-full" onClick={saveAndMarkDone} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save &amp; Mark Done
        </Button>
      </section>
    </div>
  );
}
