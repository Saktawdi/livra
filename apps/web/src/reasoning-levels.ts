/** Keep custom level names intact; only explicit separators create new levels. */
export function parseReasoningLevels(value: string | string[]): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry
          .split(/[,，;；、\r\n]+/)
          .map((level) => level.trim())
          .filter(Boolean),
      ),
    ),
  ];
}
