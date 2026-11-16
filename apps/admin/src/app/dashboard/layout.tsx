"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, setToken } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/members", label: "Members" },
  { href: "/dashboard/invitations", label: "Invitations" },
  { href: "/dashboard/drivers", label: "Drivers" },
  { href: "/dashboard/rides", label: "Rides" },
  { href: "/dashboard/payments", label: "Payments" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <span className="font-semibold text-brand-700">PrivateRide</span>
          <span className="ml-1 text-xs uppercase tracking-wide text-slate-400">
            admin
          </span>
        </div>
        <nav className="space-y-1 p-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                pathname === item.href
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => {
              setToken(null);
              router.push("/login");
            }}
            className="mt-4 block w-full rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"
          >
            Sign out
          </button>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
