import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Truck, XCircle } from "lucide-react";
import { AppShell, EmptyState, Spinner } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase, type Chalan } from "@/lib/supabase";

export const Route = createFileRoute("/driver/dashboard")({
  component: () => (
    <AppShell>
      <DriverDashboard />
    </AppShell>
  ),
});

function statusColor(chalan: Chalan) {
  if (chalan.delivery_status === "completed") return "bg-success/10 text-success";
  if (chalan.delivery_status === "not_delivered") return "bg-destructive/10 text-destructive";
  return "bg-secondary text-muted-foreground";
}

function statusLabel(chalan: Chalan) {
  if (chalan.delivery_status === "completed") return "Completed";
  if (chalan.delivery_status === "not_delivered") return "Not Delivered";
  return "Pending";
}

function DriverDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

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

  if (isLoading) return <Spinner label="Loading your route..." />;

  const rows = chalans ?? [];
  const allDone = rows.length > 0 && rows.every((c) => c.delivery_status !== "pending");
  const completedCount = rows.filter((c) => c.delivery_status === "completed").length;
  const notDeliveredCount = rows.filter((c) => c.delivery_status === "not_delivered").length;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Driver workspace</p>
        <h1 className="font-display text-xl font-semibold">Welcome, {user?.username}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} shops on your route · {completedCount} done · {notDeliveredCount} not delivered
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="No shops assigned yet"
          description="Once admin assigns you a route, your shops will appear here."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{c.party_name}</p>
                <p className="text-sm text-muted-foreground">
                  Bill {c.bill_number} · ₹{c.bill_value}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColor(c)}`}>
                  {statusLabel(c)}
                </span>
                {c.delivery_status === "pending" ? (
                  <>
                    <Button
                      size="sm"
                      variant="hero"
                      onClick={() => navigate({ to: "/driver/done/$chalanId", params: { chalanId: c.id } })}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Done
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => navigate({ to: "/driver/not-done/$chalanId", params: { chalanId: c.id } })}
                    >
                      <XCircle className="h-4 w-4" /> Not Done
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="pt-2">
          <Button
            variant="hero"
            className="w-full"
            disabled={!allDone}
            onClick={() => navigate({ to: "/driver/refreshment" })}
          >
            Continue
          </Button>
        </div>
      ) : null}
    </div>
  );
}
