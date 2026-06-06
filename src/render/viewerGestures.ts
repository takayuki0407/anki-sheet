import { useEffect, type RefObject } from "react";

/**
 * Hand-tool panning: press and drag with a mouse or pen to scroll a zoomed page in
 * both axes. Touch is intentionally left to native scrolling (one-finger pan already
 * works there). A real drag — movement past a small threshold — swallows the click
 * that the browser fires afterwards, so dragging never toggles an answer mask or
 * flips the page; a plain tap (under the threshold) still clicks normally.
 */
export function useDragPan(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down = false;
    let panning = false;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const THRESHOLD = 4; // px of movement before a press becomes a pan

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      down = true;
      panning = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!panning) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        panning = true;
        el.classList.add("grabbing");
        try {
          el.setPointerCapture(pointerId); // keep receiving moves if the cursor leaves
        } catch {
          /* capture may be unavailable */
        }
      }
      el.scrollLeft = startLeft - dx;
      el.scrollTop = startTop - dy;
      e.preventDefault(); // suppress text/image selection while dragging
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      if (!panning) return;
      panning = false;
      el.classList.remove("grabbing");
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* noop */
      }
      // Swallow the click the browser emits after a drag (capture phase, before it
      // reaches a mask / tap-zone handler). Removed on the next tick if no click came.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, true), 0);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [ref]);
}

/**
 * Trackpad pinch (and ctrl+scroll) zoom. A pinch gesture reaches the browser as a
 * wheel event with ctrlKey set; we consume those and report a multiplicative zoom
 * factor, while plain two-finger scrolling (no ctrlKey) is left alone so it pans
 * natively. No-op when onZoom is omitted (e.g. the read-only tuner preview).
 */
export function useWheelZoom(
  ref: RefObject<HTMLElement | null>,
  onZoom?: (factor: number) => void,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !onZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain wheel / two-finger scroll = pan, leave it
      e.preventDefault(); // stop the browser's own page zoom
      // deltaY < 0 (pinch open) zooms in; exponential keeps steps even across scales.
      onZoom(Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, onZoom]);
}

/**
 * Vertical-biased touch scrolling. Horizontal movement is pinned by DEFAULT for the
 * whole one-finger gesture (and its inertial fling), so a careless/quick vertical
 * swipe never drifts the page sideways. Horizontal panning unlocks only on a clear,
 * deliberate sideways motion of the finger — once the horizontal travel exceeds a
 * threshold AND clearly dominates the vertical travel — after which vertical is
 * pinned for a clean horizontal pan. The decision uses the FINGER displacement (from
 * touch events), not the post-hoc scroll delta, because we continuously pin the
 * minor axis. Native momentum is preserved; mouse/trackpad scrolling is never locked.
 */
export function useTouchAxisLock(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let mode: "v" | "h" = "v"; // "v" pins horizontal (default), "h" pins vertical
    let multi = false; // 2+ fingers down: let the browser handle it
    let lastInputTouch = false; // never lock mouse/trackpad scrolling
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    const H_UNLOCK = 28; // px of horizontal finger travel before horizontal is allowed
    const H_RATIO = 1.6; // ...and it must clearly dominate vertical travel

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        multi = true;
        return;
      }
      multi = false;
      lastInputTouch = true;
      mode = "v";
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      baseLeft = el.scrollLeft;
      baseTop = el.scrollTop;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (multi || mode === "h" || e.touches.length === 0) return;
      const t = e.touches[0];
      const fdx = Math.abs(t.clientX - startX);
      const fdy = Math.abs(t.clientY - startY);
      // Only a clearly horizontal drag releases the horizontal lock.
      if (fdx > H_UNLOCK && fdx > fdy * H_RATIO) mode = "h";
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) multi = false;
    };
    const onScroll = () => {
      if (multi || !lastInputTouch) return;
      if (mode === "v") {
        if (el.scrollLeft !== baseLeft) el.scrollLeft = baseLeft;
      } else if (el.scrollTop !== baseTop) {
        el.scrollTop = baseTop;
      }
    };
    const onWheel = () => {
      lastInputTouch = false; // mouse/trackpad: do not pin
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ref]);
}
