// The browser owns runtime preferences; legacy Node adapters also read process.env.
export const environment: Record<string, string | undefined> =
  typeof process === 'undefined' ? {} : process.env;
