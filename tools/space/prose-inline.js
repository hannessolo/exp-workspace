/**
 * Minimal ProseMirror + Yjs collab. Same shape as da-nx quick-edit-portal prose.js.
 * Uses getToken for WebSocket auth (no adobeIMS). No preview, no da-title, no edit plugins.
 */
/* eslint-disable import/no-unresolved */
import {
  EditorState,
  EditorView,
  fixTables,
  keymap,
  baseKeymap,
  Y,
  WebsocketProvider,
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
} from 'da-y-wrapper';

import { getSchema } from 'da-parser';
import { COLLAB_ORIGIN, DA_ORIGIN } from 'https://da.live/blocks/shared/constants.js';
/* eslint-enable import/no-unresolved */

function registerErrorHandler(ydoc) {
  ydoc.on('update', () => {
    const errorMap = ydoc.getMap('error');
    if (errorMap && errorMap.size > 0) {
      // eslint-disable-next-line no-console
      console.log('Error from server', JSON.stringify(errorMap));
      errorMap.clear();
    }
  });
}

function generateColor(name, hRange = [0, 360], sRange = [60, 80], lRange = [40, 60]) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);
  const normalizeHash = (min, max) => Math.floor((hash % (max - min)) + min);
  const h = normalizeHash(hRange[0], hRange[1]);
  const s = normalizeHash(sRange[0], sRange[1]);
  const l = normalizeHash(lRange[0], lRange[1]) / 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function addSyncedListener(wsProvider, canWrite, setEditable) {
  const handleSynced = (isSynced) => {
    if (isSynced) {
      if (canWrite && typeof setEditable === 'function') {
        setEditable(true);
      }
      wsProvider.off('synced', handleSynced);
    }
  };
  wsProvider.on('synced', handleSynced);
}

/**
 * Initialize minimal ProseMirror + Yjs for the given document path.
 * getToken: () => token — used for WebSocket auth; required (no adobeIMS).
 * @param {{ path: string, permissions: string[], setEditable?: (editable: boolean) => void,
 *   getToken?: () => string }} opts
 * @returns {{ proseEl: HTMLElement, wsProvider: WebsocketProvider }}
 */
export default function initProse({
  path, permissions, setEditable, getToken,
}) {
  if (window.view) {
    window.view.destroy();
    delete window.view;
  }

  const editor = document.createElement('div');
  editor.className = 'da-prose-mirror';

  const schema = getSchema();
  const ydoc = new Y.Doc();

  const server = COLLAB_ORIGIN;
  const roomName = `${DA_ORIGIN}${new URL(path).pathname}`;

  const opts = { protocols: ['yjs'] };
  if (typeof getToken === 'function') {
    const t = getToken();
    if (t) opts.params = { Authorization: `Bearer ${t}` };
  }

  const canWrite = permissions.some((permission) => permission === 'write');

  const wsProvider = new WebsocketProvider(server, roomName, ydoc, opts);
  wsProvider.maxBackoffTime = 30000;

  addSyncedListener(wsProvider, canWrite, setEditable);
  registerErrorHandler(ydoc);

  const yXmlFragment = ydoc.getXmlFragment('prosemirror');

  if (typeof getToken === 'function' && getToken()) {
    wsProvider.awareness.setLocalStateField('user', {
      color: generateColor(`${wsProvider.awareness.clientID}`),
      name: 'User',
      id: `user-${wsProvider.awareness.clientID}`,
    });
  } else {
    wsProvider.awareness.setLocalStateField('user', {
      color: generateColor(`${wsProvider.awareness.clientID}`),
      name: 'Anonymous',
      id: `anonymous-${wsProvider.awareness.clientID}`,
    });
  }

  const plugins = [
    ySyncPlugin(yXmlFragment),
    yCursorPlugin(wsProvider.awareness),
    yUndoPlugin(),
    keymap(baseKeymap),
  ];

  let state = EditorState.create({ schema, plugins });

  const fix = fixTables(state);
  if (fix) state = state.apply(fix.setMeta('addToHistory', false));

  window.view = new EditorView(editor, {
    state,
    editable() { return canWrite; },
  });

  return { proseEl: editor, wsProvider };
}
