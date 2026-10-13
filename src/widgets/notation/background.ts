/**
 * The first opaque background colour behind an element, as a concrete CSS
 * colour. VexFlow paints "cleared" boxes (behind tab fret numbers) with a
 * literal fill, which must match the panel in both themes.
 */
export function resolvedBackground(el: HTMLElement | null): string {
  let node: HTMLElement | null = el
  while (node) {
    const bg = getComputedStyle(node).backgroundColor
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) {
      // Semi-transparent panels: drop alpha so the box stays solid.
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
      return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : bg
    }
    node = node.parentElement
  }
  return getComputedStyle(document.body).backgroundColor || 'black'
}
