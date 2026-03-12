/**
 * Must run before any other script that may load da.live modules.
 * setNx() so getNx() is set in the shared utils instance (da-dialog, etc.).
 * Token is provided by DA_SDK (see file-browser); no IMS client config needed.
 */
// eslint-disable-next-line import/no-unresolved
import { setNx } from 'https://da.live/scripts/utils.js';

setNx('https://main--da-nx--adobe.aem.live/nx', window.location);
