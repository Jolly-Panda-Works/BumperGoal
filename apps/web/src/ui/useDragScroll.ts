import { useEffect, useRef, type PointerEvent, type MouseEvent } from 'react';
/** Native touch scrolling plus desktop dragging and wheel support. */
export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY;
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  return {
    ref,
    onDragStart: (event: MouseEvent) => event.preventDefault(),
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      suppressClick.current = false;
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state) return;
      const delta = event.clientX - state.x;
      if (Math.abs(delta) > 5) {
        state.moved = true;
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (state.moved) event.currentTarget.scrollLeft = state.scroll - delta;
    },
    onPointerLeave: () => {
      if (!drag.current?.moved) drag.current = null;
    },
    onMouseUp: () => {
      drag.current = null;
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
    onClickCapture: (event: MouseEvent) => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
    },
  };
}
