import { Http } from "./Http";

/**
 * Pre-built Http instance with no base URL.
 * Use for ad-hoc full-URL requests without constructing a custom instance.
 */
const http = new Http();

export default http;
