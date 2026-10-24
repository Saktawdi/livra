// Browser builds have no server environment or private-network forwarding.
export const environment: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env;
