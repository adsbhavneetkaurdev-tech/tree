/** Word-wrap `text` to `maxWidth` using the context's current font. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const push = (l: string) => lines.push(l);

  for (let wi = 0; wi < words.length; wi++) {
    let word = words[wi];
    // Hard-break words that are longer than a whole line.
    while (ctx.measureText(word).width > maxWidth) {
      let cut = word.length - 1;
      while (cut > 1 && ctx.measureText(word.slice(0, cut) + "-").width > maxWidth) cut--;
      if (line) { push(line); line = ""; }
      push(word.slice(0, cut) + "-");
      word = word.slice(cut);
    }
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else {
      push(line);
      line = word;
    }
  }
  if (line) push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1).trimEnd();
    kept[maxLines - 1] = last + "…";
    return kept;
  }
  return lines;
}

export interface PackItem {
  ideal: number; // ideal top y
  h: number;
}

/**
 * 1-D non-overlapping placement inside [min, max]: each item sits as close to
 * its ideal y as possible, keeping `gap` between neighbours and the input
 * order (which callers sort by anchor y so leader lines never cross).
 */
export function pack(items: PackItem[], min: number, max: number, gap: number): number[] {
  const n = items.length;
  const y = new Array<number>(n);
  let cursor = min;
  for (let i = 0; i < n; i++) {
    y[i] = Math.max(items[i].ideal, cursor);
    cursor = y[i] + items[i].h + gap;
  }
  let limit = max;
  for (let i = n - 1; i >= 0; i--) {
    if (y[i] + items[i].h > limit) y[i] = limit - items[i].h;
    limit = y[i] - gap;
  }
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i], min);
  return y;
}
