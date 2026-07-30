import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Lock, XCircle } from "lucide-react";
import { AppShell, Spinner } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase, type Chalan } from "@/lib/supabase";

export const Route = createFileRoute("/driver/task/$chalanId")({
  component: () => (
    <AppShell>
      <TaskScreen />
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

function TaskScreen() {
  const { chalanId } = useParams({ from: "/driver/task/$chalanId" });
  const navigate = useNavigate();

  const { data: chalan, isLoading } = useQuery({
    queryKey: ["chalan-detail", chalanId],
    queryFn: async () => {
      const { data, error } = await supabase.from("chalans").select("*").eq("id", chalanId).single();
      if (error) throw error;
      return data as Chalan;
    },
  });

  if (isLoading || !chalan) return <Spinner label="Loading task..." />;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/driver/dashboard" })} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to Tasks
      </Button>

      <div className="surface-card space-y-2 p-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold">{chalan.party_name}</h1>
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColor(chalan)}`}>
            {statusLabel(chalan)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Bill {chalan.bill_number} · ₹{chalan.bill_value}
        </p>
      </div>

      {chalan.route_locked ? (
        <div className="surface-card flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> This route has already been submitted and is locked. Ask admin to reassign this shop to make changes.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="hero"
            className="h-14"
            onClick={() => navigate({ to: "/driver/done/$chalanId", params: { chalanId: chalan.id } })}
          >
            <CheckCircle2 className="h-5 w-5" /> {chalan.delivery_status === "completed" ? "Edit Done Details" : "Mark Done"}
          </Button>
          <Button
            variant="outline"
            className="h-14 text-destructive hover:bg-destructive/10"
            onClick={() => navigate({ to: "/driver/not-done/$chalanId", params: { chalanId: chalan.id } })}
          >
            <XCircle className="h-5 w-5" /> {chalan.delivery_status === "not_delivered" ? "Edit Reason" : "Mark Not Done"}
          </Button>
        </div>
      )}
    </div>
  );
}
