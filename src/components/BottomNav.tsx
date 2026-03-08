"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CheckSquare, Repeat, Calendar, Bot } from "lucide-react";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/todos", label: "To-Dos", icon: CheckSquare },
  { href: "/habits", label: "Habits", icon: Repeat },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/chat", label: "AI", icon: Bot },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1"
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.4 : 2}
                className={active ? "text-black" : "text-gray-400"}
              />
              <span
                className={`text-[11px] ${
                  active ? "font-medium text-black" : "text-gray-400"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}