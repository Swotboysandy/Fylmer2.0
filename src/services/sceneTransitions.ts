export function transitionAt(durations: number[], time: number, enabled = true) {
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const position = Math.max(0, Math.min(total, time));
  let start = 0;
  for (let index = 0; index < durations.length; index++) {
    const end = start + durations[index];
    if (position < end || index === durations.length - 1) {
      const duration = Math.min(1, durations[index] / 2);
      const progress = enabled && index < durations.length - 1 && duration > 0
        ? Math.max(0, Math.min(1, (position - (end - duration)) / duration)) : 0;
      return { index, progress };
    }
    start = end;
  }
  return { index: 0, progress: 0 };
}

// Hold the source selection through the first 75%, then release without a boundary jump.
export function foregroundOpacity(progress: number) {
  return 1 - Math.max(0, Math.min(1, (progress - 0.75) / 0.25));
}
