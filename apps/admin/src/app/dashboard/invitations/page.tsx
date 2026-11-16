"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Invitation {
  id: string;
  role: string;
  status: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  invitedEmail: string | null;
  createdAt: string;
  invitedBy: { firstName: string; lastName: string };
}

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [role, setRole] = useState("PASSENGER");
  const [email, setEmail] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Invitation[]>("/v1/admin/invitations")
      .then(setInvitations)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ code: string }>("/v1/admin/invitations", {
        method: "POST",
        body: JSON.stringify({
          role,
          invitedEmail: email || undefined,
        }),
      });
      setNewCode(res.code);
      setEmail("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this invitation?")) return;
    await api(`/v1/admin/invitations/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Invitations</h1>

      <form
        onSubmit={create}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="text-sm">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="PASSENGER">Passenger</option>
            <option value="DRIVER">Driver</option>
            <option value="COMMUNITY_ADMIN">Community admin</option>
          </select>
        </label>
        <label className="text-sm">
          Bind to email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          Create invitation
        </button>
        {newCode && (
          <p className="text-sm">
            New code (shown once):{" "}
            <code className="rounded bg-amber-100 px-2 py-1 font-mono">
              {newCode}
            </code>
          </p>
        )}
      </form>
      {error && <p className="text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uses</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Bound email</th>
              <th className="px-4 py-3">Issued by</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">{inv.role}</td>
                <td className="px-4 py-3">{inv.status}</td>
                <td className="px-4 py-3 tabular-nums">
                  {inv.usedCount}/{inv.maxUses}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(inv.expiresAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {inv.invitedEmail ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {inv.invitedBy.firstName} {inv.invitedBy.lastName}
                </td>
                <td className="px-4 py-3">
                  {inv.status === "PENDING" && (
                    <button
                      onClick={() => revoke(inv.id)}
                      className="rounded bg-red-100 px-2 py-1 text-xs text-red-700"
                    >
                      Revoke
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
