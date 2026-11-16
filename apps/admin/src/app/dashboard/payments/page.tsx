"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatMoney } from "@/lib/api";

interface PaymentRow {
  id: string;
  status: string;
  currency: string;
  amountMinor: number;
  capturedMinor: number | null;
  refundedMinor: number;
  platformFeeMinor: number;
  provider: string;
  createdAt: string;
  ride: {
    id: string;
    pickupAddress: string;
    dropoffAddress: string;
    passenger: { firstName: string; lastName: string };
  };
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PaymentRow[]>("/v1/admin/overview/payments")
      .then(setPayments)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function refund(p: PaymentRow) {
    const input = prompt(
      `Refund amount in minor units (captured ${p.capturedMinor}, already refunded ${p.refundedMinor}):`,
    );
    if (!input) return;
    const amountMinor = parseInt(input, 10);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return;
    const reason = prompt("Reason (optional)") ?? undefined;
    try {
      await api(`/v1/admin/payments/${p.id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amountMinor, reason }),
      });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payments</h1>
      {error && <p className="text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Passenger</th>
              <th className="px-4 py-3">Captured</th>
              <th className="px-4 py-3">Refunded</th>
              <th className="px-4 py-3">Fee</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 text-slate-600">
                  {new Date(p.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {p.ride.passenger.firstName} {p.ride.passenger.lastName}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(p.capturedMinor, p.currency)}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(p.refundedMinor, p.currency)}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(p.platformFeeMinor, p.currency)}
                </td>
                <td className="px-4 py-3">
                  {p.provider}
                  {p.provider === "sandbox" && (
                    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      TEST
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{p.status}</td>
                <td className="px-4 py-3">
                  {(p.status === "CAPTURED" ||
                    p.status === "PARTIALLY_REFUNDED") && (
                    <button
                      onClick={() => refund(p)}
                      className="rounded bg-slate-200 px-2 py-1 text-xs"
                    >
                      Refund…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
