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

// iOS Safari fires non-standard gesture events for a two-finger pinch.
interface IosGestureEvent extends Event {
  scale: number;
}

/**
 * Two-finger pinch zoom on touch devices (iPhone/iPad). The page's viewport allows
 * native pinch-zoom, which would scale the whole web page; we capture iOS Safari's
 * gesture events instead, preventDefault to stop that native zoom, and feed a
 * multiplicative factor to onZoom. One-finger scrolling (native, with momentum) is
 * untouched. No-op on engines without gesture events (Android/desktop) — there the
 * trackpad/ctrl+wheel path (useWheelZoom) and native pinch still apply.
 */
export function useGesturePinch(
  ref: RefObject<HTMLElement | null>,
  onZoom?: (factor: number) => void,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !onZoom) return;
    let last = 1;
    const start = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const scale = (e as IosGestureEvent).scale || 1;
      if (last > 0 && scale > 0) onZoom(scale / last);
      last = scale;
    };
    const end = (e: Event) => {
      e.preventDefault();
      last = 1;
    };
    el.addEventListener("gesturestart", start, { passive: false });
    el.addEventListener("gesturechange", change, { passive: false });
    el.addEventListener("gestureend", end, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", start);
      el.removeEventListener("gesturechange", change);
      el.removeEventListener("gestureend", end);
    };
  }, [ref, onZoom]);
}

/**
 * Directional lock for one-finger touch scrolling. Once a gesture commits to an axis
 * (whichever it moved further along first), the other axis is pinned for the rest of
 * the gesture AND through the inertial fling that follows — so when you're scrolling
 * a zoomed page vertically it doesn't drift sideways, yet a deliberate horizontal
 * swipe still pans horizontally. Native momentum is preserved (we only pin the minor
 * axis, never drive the scroll ourselves). Mouse/trackpad scrolling is never locked.
 */
export function useTouchAxisLock(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let axis: "v" | "h" | null = null;
    let pinching = false;
    let wasPinch = false;
    let baseLeft = 0;
    let baseTop = 0;
    const THRESHOLD = 10; // px before the gesture commits to an axis

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        pinching = true;
        wasPinch = true;
        return;
      }
      // First finger down: start a fresh gesture (resets any momentum lock).
      pinching = false;
      wasPinch = false;
      axis = null;
      baseLeft = el.scrollLeft;
      baseTop = el.scrollTop;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      pinching = false;
      // After a pinch, drop the lock so the re-centering scroll isn't fought; after a
      // one-finger drag, keep it so the inertial fling stays on-axis.
      if (wasPinch) axis = null;
    };
    const onScroll = () => {
      if (pinching) return;
      if (axis === null) {
        const dL = Math.abs(el.scrollLeft - baseLeft);
        const dT = Math.abs(el.scrollTop - baseTop);
        if (Math.max(dL, dT) < THRESHOLD) return;
        axis = dT >= dL ? "v" : "h";
      }
      if (axis === "v") {
        if (el.scrollLeft !== baseLeft) el.scrollLeft = baseLeft;
      } else if (el.scrollTop !== baseTop) {
        el.scrollTop = baseTop;
      }
    };
    // Mouse/trackpad scrolling must never be axis-locked.
    const onWheel = () => {
      axis = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ref]);
}
