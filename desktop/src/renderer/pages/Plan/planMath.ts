// CL-06b plan-grid coordinate math. Pure functions only; the React
// components import these but never reach into them backwards.
//
// The grid renders 6 AM → 11 PM on a vertical column. Visual guides
// fall every 30 min; drops snap to a finer 15-min grid. A single
// PX_PER_HOUR constant drives every conversion so rendering and IPC
// stay in lockstep.

export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 23;
export const GRID_HOURS = GRID_END_HOUR - GRID_START_HOUR;
export const SLOT_VISUAL_MINUTES = 30;
export const SLOT_SNAP_MINUTES = 15;
export const PX_PER_HOUR = 80;
export const PX_PER_MINUTE = PX_PER_HOUR / 60;
export const GRID_HEIGHT_PX = GRID_HOURS * PX_PER_HOUR;

export const MIN_BLOCK_MINUTES = 15;
export const MAX_BLOCK_MINUTES = 4 * 60;
export const DEFAULT_BLOCK_MINUTES = 30;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// Midnight (00:00) of the local day containing the given timestamp.
export function localDayStartMs(anyTimeInDay: number): number {
  const d = new Date(anyTimeInDay);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Top of the visible grid (06:00 local) for the day containing
// `anyTimeInDay`. All grid-relative math uses this anchor so DST
// transitions don't smear the layout against the wrong hour.
export function gridStartMs(anyTimeInDay: number): number {
  return localDayStartMs(anyTimeInDay) + GRID_START_HOUR * MS_PER_HOUR;
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SLOT_SNAP_MINUTES) * SLOT_SNAP_MINUTES;
}

// A start position that keeps at least MIN_BLOCK_MINUTES of room
// before the bottom of the grid, and never goes negative.
export function clampStartMinutes(minutes: number): number {
  const max = GRID_HOURS * 60 - MIN_BLOCK_MINUTES;
  return Math.max(0, Math.min(minutes, max));
}

// A duration constrained to [MIN, MAX] AND to fit between the start
// and the bottom of the grid.
export function clampDurationMinutes(
  duration: number,
  startMinutes: number,
): number {
  const room = GRID_HOURS * 60 - startMinutes;
  return Math.max(
    MIN_BLOCK_MINUTES,
    Math.min(MAX_BLOCK_MINUTES, Math.min(duration, room)),
  );
}

export function minutesToPx(minutes: number): number {
  return minutes * PX_PER_MINUTE;
}

export function pxToMinutes(px: number): number {
  return px / PX_PER_MINUTE;
}

// Grid-relative minutes for an absolute timestamp. Returns negative
// values for before-grid times — callers clamp before rendering. We
// don't clamp here because resize/move math needs the raw value to
// detect "below the grid".
export function msToGridMinutes(ms: number, dayAnchor: number): number {
  return (ms - gridStartMs(dayAnchor)) / MS_PER_MINUTE;
}

export function gridMinutesToMs(
  minutes: number,
  dayAnchor: number,
): number {
  return gridStartMs(dayAnchor) + minutes * MS_PER_MINUTE;
}

// 12-hour clock label. minutesFromGridStart=0 -> '6:00 AM'; 360 ->
// '12:00 PM'; 1020 -> '11:00 PM'. We don't localize here — the rest
// of the app uses the same en-US 12h convention.
export function formatGridTime(minutesFromGridStart: number): string {
  const totalMinutes = GRID_START_HOUR * 60 + Math.round(minutesFromGridStart);
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = ((totalMinutes % 60) + 60) % 60;
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = ((hours24 + 11) % 12) + 1;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

// Render label for a placed block: "9:00 – 9:30 AM".
export function formatBlockRange(
  startMinutes: number,
  endMinutes: number,
): string {
  return `${formatGridTime(startMinutes)} – ${formatGridTime(endMinutes)}`;
}

// One row per 30-min visual slot, including the bottom edge marker.
// 6:00 AM, 6:30 AM, ..., 11:00 PM => 35 entries (6:00 + 17h*2).
export interface SlotGuide {
  minutesFromStart: number;
  hour24: number;
  isHour: boolean;
  label: string;
}

export function buildSlotGuides(): SlotGuide[] {
  const out: SlotGuide[] = [];
  const total = (GRID_HOURS * 60) / SLOT_VISUAL_MINUTES;
  for (let i = 0; i <= total; i++) {
    const minutes = i * SLOT_VISUAL_MINUTES;
    const hour24 = GRID_START_HOUR + Math.floor(minutes / 60);
    const isHour = minutes % 60 === 0;
    out.push({
      minutesFromStart: minutes,
      hour24,
      isHour,
      label: isHour ? formatGridTime(minutes) : "",
    });
  }
  return out;
}

// Drop snap target: clip backlog drops to the available range so a
// 30-min default never spills past the bottom of the grid.
export function snapAndClampStartForDuration(
  rawMinutes: number,
  durationMinutes: number,
): number {
  const snapped = snapMinutes(rawMinutes);
  const max = GRID_HOURS * 60 - durationMinutes;
  return Math.max(0, Math.min(snapped, max));
}

// Same as above for resize: lock the start, clamp the new end.
export function snapAndClampEndForStart(
  rawEndMinutes: number,
  startMinutes: number,
): number {
  const snapped = snapMinutes(rawEndMinutes);
  return Math.max(
    startMinutes + MIN_BLOCK_MINUTES,
    Math.min(GRID_HOURS * 60, Math.min(startMinutes + MAX_BLOCK_MINUTES, snapped)),
  );
}

// Sweep-line overlap detection. We render every block at full width
// and ring-flag overlapping ones (acceptance: "two overlapping blocks
// render with warning ring"). Side-by-side track layout is OUT for
// MVP — it pulls in a depth-of-tracks problem we don't need to solve
// before CL-06c lands the side panel.
export interface OverlapInput {
  id: string;
  startMs: number;
  endMs: number;
}

export function detectOverlaps(blocks: OverlapInput[]): Set<string> {
  if (blocks.length < 2) return new Set();
  const sorted = blocks
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const flagged = new Set<string>();
  // Sweep: for each block, compare with all blocks whose start is
  // before this end. Quadratic but n is dozens at most.
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.startMs >= a.endMs) break;
      flagged.add(a.id);
      flagged.add(b.id);
    }
  }
  return flagged;
}
