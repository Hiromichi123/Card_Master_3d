/** ResizeObserver misses transforms. Track only real transitions, scrolls and layout mutations. */
export function observeLayout(canvas: HTMLElement, anchors: readonly HTMLElement[], measure: () => void): () => void {
  let frame = 0, until = 0;
  const tick = (now: number) => {
    frame = 0;
    if (document.hidden) return;
    measure();
    if (now < until) frame = requestAnimationFrame(tick);
  };
  const request = (duration = 0) => {
    until = Math.max(until, performance.now() + duration);
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  };
  const change = () => request();
  const transition = (event: Event) => {
    // Ignore unrelated buttons and endlessly animated decoration elsewhere on the page.
    if (event.target instanceof Element && anchors.some(anchor => event.target === anchor || (event.target as Element).contains(anchor))) request(900);
  };
  const observer = new ResizeObserver(change);
  observer.observe(canvas);
  for (const anchor of anchors) observer.observe(anchor);
  const mutations = new MutationObserver(change);
  // Ancestor class/style changes include UI scaling and dynamically revealed menus.
  const parents = new Set<Element>();
  for (const anchor of anchors) for (let p: Element | null = anchor; p; p = p.parentElement) parents.add(p);
  for (const parent of parents) mutations.observe(parent, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  window.addEventListener('scroll', change, true);
  window.addEventListener('resize', change);
  document.addEventListener('transitionrun', transition, true);
  document.addEventListener('animationstart', transition, true);
  document.addEventListener('visibilitychange', change);
  request(900);
  return () => {
    cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect();
    window.removeEventListener('scroll', change, true);
    window.removeEventListener('resize', change);
    document.removeEventListener('transitionrun', transition, true);
    document.removeEventListener('animationstart', transition, true);
    document.removeEventListener('visibilitychange', change);
  };
}
