import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase, type Chalan } from "@/lib/supabase";

export const Route = createFileRoute("/driver/not-done/$chalanId")({
  component: () => (
    <AppShell>
      <NotDoneScreen />
    </AppShell>
  ),
});

const QUICK_REASONS = [
  "Shop Closed",
  "Owner Not Available",
  "Payment Pending",
  "Customer Refused",
  "Other",
];

function NotDoneScreen() {
  const { chalanId } = useParams({ from: "/driver/not-done/$chalanId" });
  const navigate = useNavigate();

  const { data: chalan, isLoading } = useQuery({
    queryKey: ["chalan-detail", chalanId],
    queryFn: async () => {
      const { data, error } = await supabase.from("chalans").select("*").eq("id", chalanId).single();
      if (error) throw error;
      return data as Chalan;
    },
  });

  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveNotDone() {
    const finalReason =
      selectedReason === "Other" ? customReason.trim() : selectedReason;
    if (!finalReason) {
      toast.error("Please select or enter a reason");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("chalans")
        .update({
          delivery_status: "not_delivered",
          not_delivered_reason: finalReason,
          delivered_at: new Date().toISOString(),
        })
        .eq("id", chalanId);
      if (error) throw error;

      toast.success("Marked as Not Delivered");
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
          Bill {chalan.bill_number} · ₹{chalan.bill_value}
        </p>
      </div>

      <section className="surface-card space-y-4 p-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reason
          </label>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setSelectedReason(reason)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  selectedReason === reason
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
        </div>

        {selectedReason === "Other" ? (
          <textarea
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Please describe the reason"
            className="min-h-[100px] w-full rounded-md border border-input bg-background p-3 text-sm"
          />
        ) : null}

        <Button variant="hero" className="w-full" onClick={saveNotDone} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </Button>
      </section>
    </div>
  );
}
