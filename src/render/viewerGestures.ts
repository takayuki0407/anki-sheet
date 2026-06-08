import { useEffect, type RefObject } from "react";

/**
 * Hand-tool panning: press and drag with a mouse or pen to scroll a zoomed page in
 * both axes. Touch is intentionally left to native scrolling (one-finger pan already
 * works there). A real drag — movement past a small threshold — swallows the click
 * that the browser fires afterwards, so dragging never toggles an answer mask or
 * flips the page; a plain tap (under the threshold) still clicks normally.
 */
export function useDragPan(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
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
  }, [ref, enabled]);
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
  enabled = true,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !onZoom || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain wheel / two-finger scroll = pan, leave it
      e.preventDefault(); // stop the browser's own page zoom
      // deltaY < 0 (pinch open) zooms in; exponential keeps steps even across scales.
      onZoom(Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, onZoom, enabled]);
}

/**
 * Custom one-finger touch panning with inertial momentum, choosing the axis from the
 * INITIAL drag angle (and keeping that choice for the whole gesture + its fling):
 *  - initial drag steeper than 45° (|dx| < |dy|, mostly vertical) → vertical-only,
 *    so a careless vertical swipe never drifts sideways.
 *  - initial drag at 45° or shallower (|dx| >= |dy|, clearly diagonal/horizontal) →
 *    free 2D panning that follows the finger.
 * We own the gesture (the element is touch-action: none) so the decision is reliable
 * on iOS — correcting native momentum scroll there does not work. We therefore also
 * replace native momentum with our own fling. Mouse/pen use useDragPan instead.
 */
export function useTouchPan(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let active = false;
    let mode: "none" | "vertical" | "free" = "none";
    let panned = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let vx = 0;
    let vy = 0;
    let raf = 0;
    // px the finger may travel before a press becomes a pan. Generous so a tap on an answer
    // mask still reveals it instead of being mistaken for a vertical scroll (a tap that stays
    // under this still clicks through). Raise further if taps are still read as scrolls.
    const THRESHOLD = 12;
    const MAX_V = 5; // px/ms velocity cap for the fling

    const stopMomentum = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onStart = (e: TouchEvent) => {
      stopMomentum();
      if (e.touches.length !== 1) {
        active = false; // ignore multi-touch (no pinch zoom)
        return;
      }
      active = true;
      panned = false;
      mode = "none";
      const t = e.touches[0];
      startX = lastX = t.clientX;
      startY = lastY = t.clientY;
      vx = vy = 0;
      lastT = performance.now();
    };
    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (mode === "none") {
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        // |dx| >= |dy| → initial drag at/over 45° → follow in 2D; else vertical-only.
        mode = Math.abs(dx) >= Math.abs(dy) ? "free" : "vertical";
        panned = true;
      }
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      const mdx = t.clientX - lastX;
      const mdy = t.clientY - lastY;
      lastX = t.clientX;
      lastY = t.clientY;
      lastT = now;
      vy = 0.8 * (mdy / dt) + 0.2 * vy;
      vx = mode === "free" ? 0.8 * (mdx / dt) + 0.2 * vx : 0;
      el.scrollTop -= mdy;
      if (mode === "free") el.scrollLeft -= mdx;
    };
    const onEnd = (e: TouchEvent) => {
      if (!active || e.touches.length > 0) return;
      active = false;
      if (!panned) return;
      // Swallow the click some browsers synthesize after a drag (don't toggle a mask).
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, true), 0);
      // No fling if the finger paused before lifting.
      if (performance.now() - lastT > 80) vx = vy = 0;
      let mvx = Math.max(-MAX_V, Math.min(MAX_V, vx));
      let mvy = Math.max(-MAX_V, Math.min(MAX_V, vy));
      if (Math.hypot(mvx, mvy) < 0.05) return;
      let prev = performance.now();
      const step = () => {
        const t2 = performance.now();
        const dt = t2 - prev;
        prev = t2;
        const decay = Math.pow(0.997, dt); // ms-based friction (lower = longer glide)
        mvx *= decay;
        mvy *= decay;
        const beforeTop = el.scrollTop;
        const beforeLeft = el.scrollLeft;
        el.scrollTop -= mvy * dt;
        if (mode === "free") el.scrollLeft -= mvx * dt;
        const moved = el.scrollTop !== beforeTop || el.scrollLeft !== beforeLeft;
        raf = moved && Math.hypot(mvx, mvy) > 0.02 ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      stopMomentum();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled]);
}
