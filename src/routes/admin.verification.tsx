import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, type Chalan, type Driver } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/verification")({
  component: () => (
    <AppShell>
      <VerificationScreen />
    </AppShell>
  ),
});

const PAGE_SIZE = 20;

function statusColor(status: Chalan["status"]) {
  switch (status) {
    case "verified":
      return "bg-success/10 text-success";
    case "delivered":
      return "bg-primary/10 text-primary";
    case "dispatched":
      return "bg-warning/10 text-warning-foreground";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function VerificationScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedDriver, setSelectedDriver] = useState<string>("");
  const [vehicleKm, setVehicleKm] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  const { data: chalans, isLoading: loadingChalans, refetch } = useQuery({
    queryKey: ["verification-chalans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chalans")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Chalan[];
    },
  });

  const { data: drivers, isLoading: loadingDrivers } = useQuery({
    queryKey: ["drivers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("*").eq("status", "active").order("name");
      if (error) throw error;
      return (data ?? []) as Driver[];
    },
  });

  const filtered = useMemo(() => {
    if (!chalans) return [];
    const q = search.trim().toLowerCase();
    return chalans.filter((c) => {
      const matchesSearch =
        !q ||
        c.party_name.toLowerCase().includes(q) ||
        c.bill_number.toLowerCase().includes(q) ||
        (c.owner_name ?? "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [chalans, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  async function assignDriverToAll() {
    if (!selectedDriver) {
      toast.error("Please select a driver first");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("chalans")
      .update({
        driver_id: selectedDriver,
        vehicle_km: vehicleKm ? Number(vehicleKm) : null,
      })
      .in(
        "id",
        (chalans ?? []).map((c) => c.id)
      );
    setSaving(false);
    if (error) {
      toast.error(`Could not assign driver: ${error.message}`);
      return;
    }
    toast.success("Driver and vehicle KM assigned to all shops");
    refetch();
  }

  if (loadingChalans || loadingDrivers) return <Spinner label="Loading verification data..." />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <h1 className="font-display text-lg font-semibold">Verification Dashboard</h1>
      </div>

      <section className="surface-card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Driver
            </label>
            <select
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select driver</option>
              {(drivers ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.vehicle_number ? `(${d.vehicle_number})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Vehicle KM
            </label>
            <Input
              inputMode="decimal"
              placeholder="e.g. 45210"
              value={vehicleKm}
              onChange={(e) => setVehicleKm(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="flex items-end">
            <Button variant="hero" className="w-full" onClick={assignDriverToAll} disabled={saving}>
              Assign to Route
            </Button>
          </div>
        </div>
      </section>

      <section className="surface-card space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-9"
              placeholder="Search shop, owner, or bill number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="dispatched">Dispatched</option>
            <option value="delivered">Delivered</option>
            <option value="verified">Verified</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No shops found"
            description="Try a different search or upload chalans first."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Shop</th>
                    <th className="py-2 pr-2">Owner</th>
                    <th className="py-2 pr-2">Bill</th>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2 text-right">Amount</th>
                    <th className="py-2 pl-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.map((c, i) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer transition-colors hover:bg-secondary/40"
                      onClick={() => navigate({ to: "/admin/verification/$chalanId", params: { chalanId: c.id } })}
                    >
                      <td className="py-3 pr-2 text-muted-foreground">
                        {(page - 1) * PAGE_SIZE + i + 1}
                      </td>
                      <td className="py-3 pr-2 font-medium">{c.party_name}</td>
                      <td className="py-3 pr-2 text-muted-foreground">{c.owner_name ?? "—"}</td>
                      <td className="py-3 pr-2 font-mono text-xs">{c.bill_number}</td>
                      <td className="py-3 pr-2 text-muted-foreground">{c.chalan_date ?? "—"}</td>
                      <td className="py-3 pr-2 text-right font-semibold">₹{c.bill_value}</td>
                      <td className="py-3 pl-2 text-right">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColor(c.status)}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
