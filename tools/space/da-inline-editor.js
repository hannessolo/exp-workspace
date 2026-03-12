/**
 * Inline ProseMirror editor panel. Uses minimal prose init from prose-inline.js
 * and mounts the editor when org, repo, and path are set. No toolbars/headers.
 * Uses the same token as file-browser (DA_SDK); no IMS client config.
 */
// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/blocks/shared/constants.js';
import initProse from './prose-inline.js';

const style = await getStyle(import.meta.url);
const { token } = await DA_SDK;

function afterRender(cb) {
  Promise.resolve().then(() => requestAnimationFrame(cb));
}

function buildSourceUrl(path) {
  if (!path || typeof path !== 'string') return null;
  const trimmed = path.replace(/^\//, '').trim();
  if (!trimmed) return null;
  const normalized = trimmed.endsWith('.html') || trimmed.endsWith('.json')
    ? trimmed
    : `${trimmed}.html`;
  return `${DA_ORIGIN}/source/${normalized}`;
}

function parsePermissions(resp) {
  const hint = resp.headers.get('x-da-child-actions') ?? resp.headers.get('x-da-actions');
  if (hint) resp.permissions = hint.split('=').pop().split(',');
  else resp.permissions = ['read', 'write'];
  return resp;
}

async function checkDoc(sourceUrl, authToken) {
  const resp = await fetch(sourceUrl, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return parsePermissions(resp);
}

export default class DaInlineEditor extends LitElement {
  static properties = {
    org: { type: String },
    repo: { type: String },
    path: { type: String },
    _proseEl: { state: true },
    _wsProvider: { state: true },
    _loading: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.org = '';
    this.repo = '';
    this.path = '';
    this._proseEl = null;
    this._wsProvider = null;
    this._loading = false;
    this._error = null;
  }

  get _sourceUrl() {
    return buildSourceUrl(this.path);
  }

  get _canLoad() {
    return this.org && this.repo && this.path && this._sourceUrl;
  }

  _setEditable(editable) {
    this.requestUpdate();
    afterRender(() => {
      const pm = this.shadowRoot?.querySelector('.da-inline-editor-mount .ProseMirror');
      if (pm) pm.contentEditable = editable ? 'true' : 'false';
    });
  }

  async _loadEditor() {
    if (!this._canLoad) return;

    const sourceUrl = this._sourceUrl;

    if (this._wsProvider) {
      this._wsProvider.disconnect({ data: 'Path changed' });
      this._wsProvider = undefined;
    }
    if (this._proseEl && this._proseEl.parentNode) {
      this._proseEl.remove();
    }
    this._proseEl = null;
    this._error = null;
    this._loading = true;
    this.requestUpdate();

    try {
      if (!token) {
        this._error = 'Sign in required';
        this._loading = false;
        this.requestUpdate();
        return;
      }

      const resp = await checkDoc(sourceUrl, token);
      if (!resp.ok && resp.status !== 404) {
        this._error = resp.status === 401 ? 'Sign in required' : `Failed to load (${resp.status})`;
        this._loading = false;
        this.requestUpdate();
        return;
      }

      const permissions = resp.permissions || ['read'];

      const setEditable = (editable) => this._setEditable(editable);
      const getToken = () => token;
      const { proseEl, wsProvider } = initProse({
        path: sourceUrl,
        permissions,
        setEditable,
        getToken,
      });

      this._proseEl = proseEl;
      this._wsProvider = wsProvider;
    } catch (e) {
      this._error = e?.message || 'Failed to load editor';
      this._proseEl = null;
      this._wsProvider = null;
    }

    this._loading = false;
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
  }

  updated(changed) {
    super.updated?.(changed);
    if (changed.has('org') || changed.has('repo') || changed.has('path')) {
      this._loadEditor();
    }
    if (this._proseEl) {
      const mount = this.shadowRoot?.querySelector('.da-inline-editor-mount');
      if (mount && !mount.contains(this._proseEl)) {
        mount.appendChild(this._proseEl);
      }
    }
  }

  disconnectedCallback() {
    if (this._wsProvider) {
      this._wsProvider.disconnect({ data: 'Component unmount' });
      this._wsProvider = undefined;
    }
    this._proseEl = null;
    super.disconnectedCallback();
  }

  render() {
    if (!this.org || !this.repo) {
      return html`
        <div class="da-inline-editor">
          <div class="da-inline-editor-placeholder">
            Set hash to <code>#/org/site</code> and select a file to edit.
          </div>
        </div>
      `;
    }

    if (!this.path) {
      return html`
        <div class="da-inline-editor">
          <div class="da-inline-editor-placeholder">
            Select a file to edit.
          </div>
        </div>
      `;
    }

    if (this._error) {
      return html`
        <div class="da-inline-editor">
          <div class="da-inline-editor-error">${this._error}</div>
        </div>
      `;
    }

    if (this._loading) {
      return html`
        <div class="da-inline-editor">
          <div class="da-inline-editor-placeholder">Loading editor…</div>
        </div>
      `;
    }

    return html`
      <div class="da-inline-editor">
        <div class="da-inline-editor-mount"></div>
      </div>
    `;
  }
}

customElements.define('da-inline-editor', DaInlineEditor);
