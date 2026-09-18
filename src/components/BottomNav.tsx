"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, Inbox, MessageCircle, Rows3, WalletCards } from "lucide-react";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/todos", label: "Tasks", icon: Rows3 },
  { href: "/finance", label: "Finance", icon: WalletCards },
  { href: "/chat", label: "Chat", icon: MessageCircle },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="ass-bottom-nav" aria-label="Primary navigation">
      <div className="ass-nav-inner">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" size={21} strokeWidth={active ? 2.2 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
