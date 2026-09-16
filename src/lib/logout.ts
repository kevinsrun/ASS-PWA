/** Clear ASS-owned private caches, never third-party storage or service grants. */
export function clearPrivateStorage(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith("ass_") || key?.startsWith("ass:")));
  keys.forEach(key => storage.removeItem(key));
}
export async function logoutFromAss(dependencies: {
  signOut: () => Promise<{ error: { message: string } | null }>;
  clearState: () => void; local: Pick<Storage, "length" | "key" | "removeItem">;
  session: Pick<Storage, "length" | "key" | "removeItem">;
  navigate: (path: string) => void;
}) {
  const { error } = await dependencies.signOut();
  if (error) throw new Error(error.message);
  clearPrivateStorage(dependencies.local);
  clearPrivateStorage(dependencies.session);
  dependencies.clearState();
  dependencies.navigate("/login");
}
