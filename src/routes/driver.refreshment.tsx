import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase, type Chalan } from "@/lib/supabase";

export const Route = createFileRoute("/driver/refreshment")({
  component: () => (
    <AppShell>
      <RefreshmentScreen />
    </AppShell>
  ),
});

function RefreshmentScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const { data: chalans, isLoading } = useQuery({
    queryKey: ["driver-chalans", user?.driver_id],
    enabled: !!user?.driver_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chalans")
        .select("*")
        .eq("driver_id", user!.driver_id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Chalan[];
    },
  });

  async function submitRefreshment() {
    setSaving(true);
    try {
      const rows = chalans ?? [];
      const completedCount = rows.filter((c) => c.delivery_status === "completed").length;
      const notDeliveredCount = rows.filter((c) => c.delivery_status === "not_delivered").length;

      await supabase
        .from("chalans")
        .update({ route_locked: true })
        .eq("driver_id", user!.driver_id)
        .neq("delivery_status", "pending");

      const { error } = await supabase.from("route_completions").insert({
        driver_id: user!.driver_id,
        driver_name: user!.username,
        total_shops: rows.length,
        completed_shops: completedCount,
        not_delivered_shops: notDeliveredCount,
        refreshment_amount: amount ? Number(amount) : null,
        completed_at: new Date().toISOString(),
      });
      if (error) throw error;

      setDone(true);
    } catch (err: any) {
      toast.error(`Could not submit: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Spinner label="Loading..." />;

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-10 w-10" />
        </span>
        <h1 className="font-display text-2xl font-semibold">Job Done!</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your route is complete. Great work today.
        </p>
        <Button variant="hero" onClick={() => navigate({ to: "/driver/dashboard" })}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 py-10">
      <div className="text-center">
        <h1 className="font-display text-lg font-semibold">How much for refreshment?</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the amount spent, if any.</p>
      </div>
      <Input
        inputMode="decimal"
        placeholder="e.g. 100"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="h-12 text-center text-lg"
      />
      <Button variant="hero" className="w-full" onClick={submitRefreshment} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit
      </Button>
    </div>
  );
}
