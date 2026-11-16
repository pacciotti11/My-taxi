"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Member {
  id: string;
  status: string;
  createdAt: string;
  suspendedReason: string | null;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    roles: { role: { name: string } }[];
  };
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  SUSPENDED: "bg-red-100 text-red-800",
  REJECTED: "bg-slate-200 text-slate-600",
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = filter ? `?status=${filter}` : "";
    api<Member[]>(`/v1/admin/members${q}`)
      .then(setMembers)
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(load, [load]);

  async function act(id: string, action: "approve" | "suspend" | "reject") {
    const reason =
      action === "approve"
        ? undefined
        : prompt("Reason (optional)") ?? undefined;
    try {
      await api(`/v1/admin/members/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>
      {error && <p className="text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  {m.user.firstName} {m.user.lastName}
                </td>
                <td className="px-4 py-3 text-slate-600">{m.user.email}</td>
                <td className="px-4 py-3 text-slate-600">
                  {m.user.roles.map((r) => r.role.name).join(", ")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[m.status] ?? "bg-slate-100"}`}
                    title={m.suspendedReason ?? undefined}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="space-x-2 px-4 py-3">
                  {m.status === "PENDING_APPROVAL" && (
                    <>
                      <button
                        onClick={() => act(m.id, "approve")}
                        className="rounded bg-brand-600 px-2 py-1 text-xs text-white"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => act(m.id, "reject")}
                        className="rounded bg-slate-200 px-2 py-1 text-xs"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {m.status === "ACTIVE" && (
                    <button
                      onClick={() => act(m.id, "suspend")}
                      className="rounded bg-red-100 px-2 py-1 text-xs text-red-700"
                    >
                      Suspend
                    </button>
                  )}
                  {m.status === "SUSPENDED" && (
                    <button
                      onClick={() => act(m.id, "approve")}
                      className="rounded bg-brand-600 px-2 py-1 text-xs text-white"
                    >
                      Reinstate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No members match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
