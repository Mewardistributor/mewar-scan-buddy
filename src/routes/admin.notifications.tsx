import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bell } from "lucide-react";
import { AppShell, EmptyState, Spinner } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/notifications")({
  component: () => (
    <AppShell>
      <NotificationsScreen />
    </AppShell>
  ),
});

type RouteCompletion = {
  id: string;
  driver_name: string;
  total_shops: number;
  completed_shops: number;
  not_delivered_shops: number;
  refreshment_amount: number | null;
  completed_at: string;
};

function NotificationsScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  const { data, isLoading } = useQuery({
    queryKey: ["route-completions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_completions")
        .select("*")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RouteCompletion[];
    },
    refetchInterval: 15000,
  });

  if (isLoading) return <Spinner label="Loading notifications..." />;

  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <h1 className="font-display text-lg font-semibold">Route Completions</h1>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-6 w-6" />}
          title="No completions yet"
          description="When a driver finishes their route, it will show up here."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="surface-card space-y-1 p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.driver_name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.completed_at).toLocaleString(undefined, {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {r.total_shops} shops · {r.completed_shops} completed · {r.not_delivered_shops} not delivered
                {r.refreshment_amount ? ` · ₹${r.refreshment_amount} refreshment` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
