"use client";

import { useEffect, useState } from "react";
import { api, formatMoney } from "@/lib/api";

interface Overview {
  members: { total: number; active: number; pending: number };
  drivers: { approved: number; online: number };
  rides: { active: number; completed: number; cancelled: number };
  finance: {
    capturedMinor: number;
    platformRevenueMinor: number;
    outstandingPayoutsMinor: number;
  };
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>("/v1/admin/overview").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Members (active / total)" value={`${data.members.active} / ${data.members.total}`} />
        <Stat label="Pending approvals" value={data.members.pending} />
        <Stat label="Drivers approved" value={data.drivers.approved} />
        <Stat label="Drivers online" value={data.drivers.online} />
        <Stat label="Active rides" value={data.rides.active} />
        <Stat label="Completed rides" value={data.rides.completed} />
        <Stat label="Cancelled rides" value={data.rides.cancelled} />
        <Stat label="Payment volume" value={formatMoney(data.finance.capturedMinor)} />
        <Stat label="Platform revenue" value={formatMoney(data.finance.platformRevenueMinor)} />
        <Stat label="Outstanding payouts" value={formatMoney(data.finance.outstandingPayoutsMinor)} />
      </section>
    </div>
  );
}
