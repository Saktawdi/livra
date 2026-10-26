export function marpThemeName(css: string) {
  return /\/\*\s*@theme\s+([a-z][a-z0-9-]{0,40})\s*\*\//i.exec(css)?.[1];
}
export function applyMarpTheme(markdown: string, name: string) {
  const front =
    markdown.startsWith('---\n') || markdown.startsWith('---\r\n')
      ? /^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(markdown)
      : null;
  if (!front) return `---\ntheme: ${name}\n---\n\n${markdown}`;
  const newline = front[0].includes('\r\n') ? '\r\n' : '\n';
  const body = /^[ \t]*theme[ \t]*:/m.test(front[1])
    ? front[1].replace(/^[ \t]*theme[ \t]*:[^\r\n]*/m, 'theme: ' + name)
    : front[1] + `theme: ${name}${newline}`;
  return (
    `---${newline}${body}---${front[0].endsWith('\n') ? newline : ''}` +
    markdown.slice(front[0].length)
  );
}
