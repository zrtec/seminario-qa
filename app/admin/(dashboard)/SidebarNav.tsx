"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Conferencias" },
  { href: "/admin/organizaciones", label: "Organizaciones" },
  { href: "/admin/asistentes", label: "Asistentes" },
  { href: "/admin/checkin", label: "Check-in" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((item) => {
        const activo = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              activo ? "bg-white/15 text-white" : "text-[#cddce6] hover:bg-white/10 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
