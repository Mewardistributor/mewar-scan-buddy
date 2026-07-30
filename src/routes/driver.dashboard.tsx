import { createFileRoute } from "@tanstack/react-router";
import { Truck } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/driver/dashboard")({
  component: () => (
    <AppShell>
      <DriverDashboard />
    </AppShell>
  ),
});

function DriverDashboard() {
  const { user } = useAuth();
  return (
    <div className="space-y-5">
      <h1 className="font-display text-lg font-semibold">Welcome, {user?.username}</h1>
      <EmptyState
        icon={<Truck className="h-6 w-6" />}
        title="Your route is being set up"
        description="Assigned shops for your route will appear here soon."
      />
    </div>
  );
}
