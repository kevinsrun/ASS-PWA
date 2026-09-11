"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  CheckSquare,
  Repeat,
  Calendar,
  Bot,
  BookOpen,
  GraduationCap,
  UserRound,
} from "lucide-react";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/todos", label: "To-Dos", icon: CheckSquare },
  { href: "/habits", label: "Habits", icon: Repeat, className: "hidden sm:flex" },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/academics", label: "Academics", icon: GraduationCap },
  { href: "/chat", label: "AI", icon: Bot },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="ass-bottom-nav fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-around px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${item.className ?? "flex"} min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 transition ${
                active
                  ? "bg-gradient-to-br from-violet-50 to-blue-50"
                  : "hover:bg-slate-50/70"
              }`}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.4 : 2}
                className={active ? "text-violet-600" : "text-slate-400"}
              />
              <span
                className={`text-[11px] ${
                  active ? "font-medium text-violet-700" : "text-slate-400"
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
