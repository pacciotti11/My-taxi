"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Driver {
  id: string;
  verificationStatus: string;
  isOnline: boolean;
  ratingAvg: string;
  ratingCount: number;
  licenseNumber: string | null;
  user: { firstName: string; lastName: string; email: string };
  vehicles: {
    id: string;
    make: string;
    model: string;
    registrationNumber: string;
    category: string;
    verificationStatus: string;
    active: boolean;
  }[];
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Driver[]>("/v1/admin/overview/drivers")
      .then(setDrivers)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function setDriverStatus(id: string, status: string) {
    await api(`/v1/admin/drivers/${id}/verification`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }).catch((e) => alert(e.message));
    load();
  }

  async function setVehicleStatus(id: string, status: string) {
    await api(`/v1/admin/drivers/vehicles/${id}/verification`, {
      method: "POST",
      body: JSON.stringify({ status, active: status === "APPROVED" }),
    }).catch((e) => alert(e.message));
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Drivers</h1>
      {error && <p className="text-red-600">{error}</p>}
      <div className="space-y-4">
        {drivers.map((d) => (
          <div
            key={d.id}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {d.user.firstName} {d.user.lastName}{" "}
                  <span
                    className={`ml-1 inline-block h-2 w-2 rounded-full ${d.isOnline ? "bg-green-500" : "bg-slate-300"}`}
                    title={d.isOnline ? "online" : "offline"}
                  />
                </p>
                <p className="text-sm text-slate-500">
                  {d.user.email} · license {d.licenseNumber ?? "—"} · rating{" "}
                  {Number(d.ratingAvg).toFixed(2)} ({d.ratingCount})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                  {d.verificationStatus}
                </span>
                {d.verificationStatus !== "APPROVED" && (
                  <button
                    onClick={() => setDriverStatus(d.id, "APPROVED")}
                    className="rounded bg-brand-600 px-2 py-1 text-xs text-white"
                  >
                    Approve
                  </button>
                )}
                {d.verificationStatus === "APPROVED" && (
                  <button
                    onClick={() => setDriverStatus(d.id, "SUSPENDED")}
                    className="rounded bg-red-100 px-2 py-1 text-xs text-red-700"
                  >
                    Suspend
                  </button>
                )}
              </div>
            </div>
            {d.vehicles.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {d.vehicles.map((v) => (
                    <tr key={v.id} className="border-t border-slate-100">
                      <td className="py-2">
                        {v.make} {v.model} · {v.registrationNumber} ·{" "}
                        {v.category}
                      </td>
                      <td className="py-2 text-right">
                        <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                          {v.verificationStatus}
                          {v.active ? " · active" : ""}
                        </span>
                        {v.verificationStatus !== "APPROVED" && (
                          <button
                            onClick={() => setVehicleStatus(v.id, "APPROVED")}
                            className="rounded bg-brand-600 px-2 py-1 text-xs text-white"
                          >
                            Approve vehicle
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
        {drivers.length === 0 && !error && (
          <p className="text-slate-400">No drivers yet.</p>
        )}
      </div>
    </div>
  );
}
