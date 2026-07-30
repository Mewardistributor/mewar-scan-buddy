import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Trash2, Truck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Spinner, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, type Driver } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/drivers")({
  component: () => (
    <AppShell>
      <DriversScreen />
    </AppShell>
  ),
});

type DriverLogin = {
  id: string;
  username: string;
  driver_id: string | null;
};

function DriversScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/" });
  }, [user, navigate]);

  const { data: drivers, isLoading: loadingDrivers } = useQuery({
    queryKey: ["all-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Driver[];
    },
  });

  const { data: logins, isLoading: loadingLogins } = useQuery({
    queryKey: ["driver-logins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, username, driver_id")
        .eq("role", "driver");
      if (error) throw error;
      return (data ?? []) as DriverLogin[];
    },
  });

 const loginedDriverIds = new Set((logins ?? []).map((l) => l.driver_id).filter(Boolean));
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteDriver(driverId: string, driverName: string) {
    if (!window.confirm(`Delete "${driverName}"? This will remove the driver and their login. This cannot be undone.`)) {
      return;
    }
    setDeletingId(driverId);
    try {
      const { error: userErr } = await supabase.from("users").delete().eq("driver_id", driverId);
      if (userErr) throw userErr;
      const { error: driverErr } = await supabase.from("drivers").delete().eq("id", driverId);
      if (driverErr) throw driverErr;
      toast.success(`${driverName} deleted`);
      qc.invalidateQueries({ queryKey: ["all-drivers"] });
      qc.invalidateQueries({ queryKey: ["driver-logins"] });
    } catch (err: any) {
      toast.error(`Could not delete: ${err.message ?? err}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function createDriverLogin() {
    if (!name.trim() || !username.trim() || !password.trim()) {
      toast.error("Please fill driver name, username and password");
      return;
    }
    setSaving(true);
    try {
      const { data: driverRow, error: driverErr } = await supabase
        .from("drivers")
        .insert({ name: name.trim(), phone: phone.trim() || null, vehicle_number: vehicle.trim() || null, status: "active" })
        .select()
        .single();
      if (driverErr) throw driverErr;

      const { error: userErr } = await supabase.from("users").insert({
        username: username.trim(),
        password: password.trim(),
        role: "driver",
        driver_id: driverRow.id,
      });
      if (userErr) throw userErr;

      toast.success(`Driver login created for ${name.trim()}`);
      setName("");
      setPhone("");
      setVehicle("");
      setUsername("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["all-drivers"] });
      qc.invalidateQueries({ queryKey: ["driver-logins"] });
    } catch (err: any) {
      toast.error(`Could not create driver: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }

  if (loadingDrivers || loadingLogins) return <Spinner label="Loading drivers..." />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Button>
        <h1 className="font-display text-lg font-semibold">Driver Logins</h1>
      </div>

      <section className="surface-card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Create new driver login</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Driver name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input placeholder="Vehicle number (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          <div />
          <Input placeholder="Login username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input placeholder="Login password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button variant="hero" onClick={createDriverLogin} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create Driver Login
        </Button>
      </section>

      <section className="surface-card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Existing drivers</h2>
        {(drivers ?? []).length === 0 ? (
          <EmptyState icon={<Truck className="h-6 w-6" />} title="No drivers yet" description="Create your first driver login above." />
        ) : (
          <div className="divide-y divide-border">
            {(drivers ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.phone ?? "—"} · {d.vehicle_number ?? "—"}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    loginedDriverIds.has(d.id) ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {loginedDriverIds.has(d.id) ? "Login active" : "No login"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
