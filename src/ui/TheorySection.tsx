/** Shared card wrapper for theory-panel sections (scenario + controller). */
export function TheorySection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}
