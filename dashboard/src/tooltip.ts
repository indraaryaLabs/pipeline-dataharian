import { h } from './dom.ts';

export interface Tooltip {
  show(content: (Node | string)[], clientX: number, clientY: number): void;
  hide(): void;
}

const GAP = 14;

/** One floating label shared by every chart. Pointer-only: keyboard users get lists and tables. */
export function createTooltip(): Tooltip {
  const element = h('div', { class: 'tip', hidden: true, 'aria-hidden': 'true' });
  document.body.append(element);

  return {
    show(content, clientX, clientY) {
      element.replaceChildren(...content);
      element.hidden = false;
      const box = element.getBoundingClientRect();
      const x = Math.min(clientX + GAP, window.innerWidth - box.width - 8);
      const flip = clientY + GAP + box.height > window.innerHeight - 8;
      const y = flip ? clientY - GAP - box.height : clientY + GAP;
      element.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    },
    hide() {
      element.hidden = true;
    },
  };
}
