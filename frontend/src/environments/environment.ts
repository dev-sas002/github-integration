/**
 * Build-time frontend configuration.
 *
 * `apiBaseUrl` is a *relative* path on purpose. In development `ng serve`
 * proxies `/api` to the backend (see `proxy.conf.json`); in the container the
 * same path is proxied by nginx. Nothing about the deployment is baked into
 * the bundle, and the browser never makes a cross-origin call, so no CORS
 * preflight is involved in either environment.
 */
export const environment = {
  production: false,
  apiBaseUrl: '/api',
};
