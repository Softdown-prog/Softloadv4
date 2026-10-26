/** Reusable Canvas 2D primitives. No game rules, scenes or assets bundled. */
export interface LoopOptions {
    update(dt: number): void;
    render(interpolation: number): void;
    hz?: number;
    maxSteps?: number;
    requestFrame?: (fn: (time: number) => void) => number;
    cancelFrame?: (handle: number) => void;
}
export interface LoopController { start(): void; stop(): void }
export function createLoop({ update, render, hz = 60, maxSteps = 5, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }: LoopOptions): LoopController {
    if (!(hz > 0) || !Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('Invalid loop configuration');
    const step = 1 / hz;
    let last: number | null = null, accumulator = 0, handle: number | null = null, running = false;
    function frame(time: number): void {
        if (!running) return;
        // Bound catch-up after backgrounding; a long pause must not freeze input.
        if (last !== null) accumulator += Math.min(Math.max(0, (time - last) / 1000), step * maxSteps);
        last = time;
        let steps = 0;
        while (accumulator >= step && steps++ < maxSteps) { update(step); accumulator -= step; }
        render(accumulator / step);
        if (running) handle = requestFrame(frame);
    }
    return {
        start() { if (!running) { running = true; last = null; accumulator = 0; handle = requestFrame(frame); } },
        stop() { running = false; if (handle !== null) cancelFrame(handle); handle = null; last = null; accumulator = 0; },
    };
}

/** Call destroy when removing a scene. Pointer and keyboard share action state. */
export interface InputController {
    down(action: string): boolean;
    pointers: Map<number, { x: number; y: number }>;
    destroy(): void;
}
export type InputBindings = Record<string, string>;
export function createInput(target: HTMLElement, bindings: InputBindings = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'action' }): InputController {
    const keys = new Set<string>(), pointers = new Map<number, { x: number; y: number }>();
    const keydown = (e: Event): void => { const key = e as KeyboardEvent; if (bindings[key.code]) { keys.add(key.code); key.preventDefault(); } };
    const keyup = (e: Event): void => { keys.delete((e as KeyboardEvent).code); };
    const clear = (): void => { keys.clear(); pointers.clear(); };
    const view = target.ownerDocument?.defaultView || target;
    const keyboardTarget = target;
    if ('tabIndex' in target && target.tabIndex < 0) target.tabIndex = 0;
    const pointerdown = (e: Event): void => { const pointer = e as PointerEvent; target.focus?.({ preventScroll: true }); pointers.set(pointer.pointerId, { x: pointer.offsetX, y: pointer.offsetY }); target.setPointerCapture?.(pointer.pointerId); };
    const pointermove = (e: Event): void => { const pointer = e as PointerEvent; if (pointers.has(pointer.pointerId)) pointers.set(pointer.pointerId, { x: pointer.offsetX, y: pointer.offsetY }); };
    const pointerup = (e: Event): void => { pointers.delete((e as PointerEvent).pointerId); };
    const listeners: Array<[EventTarget, string, EventListener]> = [[keyboardTarget, 'keydown', keydown], [keyboardTarget, 'keyup', keyup], [keyboardTarget, 'blur', clear], [view, 'blur', clear],
        [target, 'pointerdown', pointerdown], [target, 'pointermove', pointermove], [target, 'pointerup', pointerup], [target, 'pointercancel', pointerup]];
    for (const [el, name, fn] of listeners) el.addEventListener(name, fn);
    return { down: action => [...keys].some(code => bindings[code] === action), pointers,
        destroy() { for (const [el, name, fn] of listeners) el.removeEventListener(name, fn); clear(); } };
}

export interface Point { x: number; y: number }
export interface Box extends Point { width: number; height: number }
export const isoToScreen = (x: number, y: number, tileWidth = 128, tileHeight = 64): Point => ({ x: (x - y) * tileWidth / 2, y: (x + y) * tileHeight / 2 });
export const screenToIso = (x: number, y: number, tileWidth = 128, tileHeight = 64): Point => ({ x: x / tileWidth + y / tileHeight, y: y / tileHeight - x / tileWidth });
export const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Move an AABB on each axis, clamping at obstacles to avoid tunnelling. */
export function moveAndCollide<T extends Box>(body: T, dx: number, dy: number, obstacles: Box[]): T {
    let x = body.x, y = body.y;
    for (const o of obstacles) if (y < o.y + o.height && y + body.height > o.y) {
        if (dx > 0 && x + body.width <= o.x) dx = Math.min(dx, o.x - x - body.width);
        if (dx < 0 && x >= o.x + o.width) dx = Math.max(dx, o.x + o.width - x);
    }
    x += dx;
    for (const o of obstacles) if (x < o.x + o.width && x + body.width > o.x) {
        if (dy > 0 && y + body.height <= o.y) dy = Math.min(dy, o.y - y - body.height);
        if (dy < 0 && y >= o.y + o.height) dy = Math.max(dy, o.y + o.height - y);
    }
    return { ...body, x, y: y + dy };
}

/** Draw a rectangle from A7 animation.json by its real duration and anchor. */
export interface AnimationFrame { durationMs: number; rect: [number, number, number, number]; anchor?: [number, number] }
export interface AnimationContract { frames: AnimationFrame[]; loop?: boolean; anchor?: [number, number]; pixelArt?: boolean }
export function drawAnimation(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, animation: AnimationContract, elapsedMs: number, x: number, y: number): void {
    const frames = animation.frames;
    if (!Array.isArray(frames) || !frames.length) throw new Error('Animation has no frames');
    const total = frames.reduce((sum, f) => sum + f.durationMs, 0);
    if (!(total > 0)) throw new Error('Invalid animation duration');
    let time = animation.loop === false ? Math.min(Math.max(0, elapsedMs), total - Number.EPSILON * total) : ((elapsedMs % total) + total) % total;
    let frame = frames[0];
    for (const candidate of frames) { frame = candidate; if (time < frame.durationMs) break; time -= frame.durationMs; }
    const rect = frame.rect;
    const anchor = frame.anchor || animation.anchor || [0, 0];
    ctx.save();
    ctx.imageSmoothingEnabled = animation.pixelArt !== true;
    ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], x - anchor[0], y - anchor[1], rect[2], rect[3]);
    ctx.restore();
}

export function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, pixelRatio = globalThis.devicePixelRatio || 1): CanvasRenderingContext2D {
    const ratio = Math.min(2, Math.max(1, pixelRatio));
    canvas.width = Math.round(cssWidth * ratio); canvas.height = Math.round(cssHeight * ratio);
    canvas.style.width = `${cssWidth}px`; canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d'); ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx!;
}
