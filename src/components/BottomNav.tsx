"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  CheckSquare,
  Repeat,
  Calendar,
  Bot
} from "lucide-react";

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
    <nav className="fixed bottom-0 left-0 right-0 border-t bg-white">
      <div className="mx-auto flex max-w-4xl justify-around py-2">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center text-xs"
            >
              <Icon
                size={22}
                className={active ? "text-black" : "text-gray-400"}
              />
              <span className={active ? "text-black font-medium" : "text-gray-400"}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}