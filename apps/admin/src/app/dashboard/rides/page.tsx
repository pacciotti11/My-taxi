"use client";

import { useEffect, useState } from "react";
import { api, formatMoney } from "@/lib/api";

interface RideRow {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  currency: string;
  estimatedFareMinor: number | null;
  finalFareMinor: number | null;
  requestedAt: string;
  passenger: { firstName: string; lastName: string };
  driver: { user: { firstName: string; lastName: string } } | null;
}

const ACTIVE = new Set([
  "REQUESTED",
  "SEARCHING",
  "OFFERED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "PAYMENT_PENDING",
]);

export default function RidesPage() {
  const [rides, setRides] = useState<RideRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RideRow[]>("/v1/admin/overview/rides")
      .then(setRides)
      .catch((e) => setError(e.message));
    const timer = setInterval(() => {
      api<RideRow[]>("/v1/admin/overview/rides").then(setRides).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Rides</h1>
      {error && <p className="text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Passenger</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Fare</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rides.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 text-slate-600">
                  {new Date(r.requestedAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {r.passenger.firstName} {r.passenger.lastName}
                </td>
                <td className="px-4 py-3">
                  {r.driver
                    ? `${r.driver.user.firstName} ${r.driver.user.lastName}`
                    : "—"}
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                  {r.pickupAddress} → {r.dropoffAddress}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(r.finalFareMinor ?? r.estimatedFareMinor, r.currency)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      ACTIVE.has(r.status)
                        ? "bg-blue-100 text-blue-800"
                        : r.status === "COMPLETED"
                          ? "bg-green-100 text-green-800"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Auto-refreshes every 10 seconds.</p>
    </div>
  );
}
