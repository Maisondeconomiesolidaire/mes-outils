export function MissingConfig({ missing }: { missing: string[] }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-card w-full max-w-xl rounded-lg border border-[var(--border)] p-8">
        <div className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-800">
          Mes Outils
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Configuration requise
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Les variables d'environnement suivantes sont manquantes avant de lancer le portail.
        </p>
        <ul className="mt-5 space-y-2">
          {missing.map((item) => (
            <li
              key={item}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 font-mono text-sm text-[var(--foreground)]"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
