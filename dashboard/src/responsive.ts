/** Calls `draw` with the element's width now and whenever it changes. Returns a stop function. */
export function watchWidth(element: HTMLElement, draw: (width: number) => void): () => void {
  let last = 0;
  let frame = 0;
  const run = (): void => {
    frame = 0;
    const width = Math.round(element.getBoundingClientRect().width);
    if (width > 0 && width !== last) {
      last = width;
      draw(width);
    }
  };
  const observer = new ResizeObserver(() => {
    if (frame === 0) frame = requestAnimationFrame(run);
  });
  observer.observe(element);
  run();
  return () => {
    observer.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}
