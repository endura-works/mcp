// Microtasks' own settings for the pipe. Trail's package gets its own port and origin.
export const DEFAULT_PORT = 47321;
export const APP_URL = 'https://microtasks.endura.works/';

// The live site, and any local development server (the app's own :8391/:8392).
export const allowOrigin = o => o === 'https://microtasks.endura.works' || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o);

/** The address that pairs a tab: `#mcp`, or `#mcp=<port>` off the default. */
export const pairUrlFor = (url, port) => url.replace(/#.*$/, '') + (port === DEFAULT_PORT ? '#mcp' : `#mcp=${port}`);
