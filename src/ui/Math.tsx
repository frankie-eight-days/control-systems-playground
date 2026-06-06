import katex from 'katex'
import { useMemo } from 'react'

/** KaTeX equation. Theory ↔ simulation linkage is the app's core principle —
 *  equations are first-class UI, not decoration. */
export function Tex({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: block, throwOnError: false }),
    [tex, block],
  )
  return (
    <span
      className={block ? 'block overflow-x-auto py-1' : ''}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
