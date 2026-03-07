import Link from "next/link";

export default function NavBar() {
  return (
    <nav className="border-b bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="text-lg font-bold">ASS</div>

        <div className="flex gap-3 text-sm">
          <Link href="/" className="hover:text-blue-600">
            Home
          </Link>

          <Link href="/todos" className="hover:text-blue-600">
            Todos
          </Link>

          <Link href="/habits" className="hover:text-blue-600">
            Habits
          </Link>

          <Link href="/calendar" className="hover:text-blue-600">
            Calendar
          </Link>

          <Link href="/chat" className="hover:text-blue-600">
            AI Chat
          </Link>
        </div>
      </div>
    </nav>
  );
}