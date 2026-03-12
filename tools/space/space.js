// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';
// eslint-disable-next-line import/no-unresolved
import '../../src/chat/chat.js';
// eslint-disable-next-line import/no-unresolved
import '../../src/file-browser/file-browser.js';
import './da-inline-editor.js';

const style = await getStyle(import.meta.url);

/**
 * Parse hash to get org and repo. Hash format: #/org/site or #/org/site/path
 * @returns {{ org: string, repo: string } | null}
 */
function getOrgRepoFromHash() {
  const hash = window.location.hash || '';
  const path = hash.replace(/^#\/?/, '').trim();
  if (!path) return null;
  const pathSegments = path.split('/').filter(Boolean);
  if (pathSegments.length < 2) return null;
  return { org: pathSegments[0], repo: pathSegments[1] };
}

class Space extends LitElement {
  static properties = {
    projects: { type: Array },
    _selectedPath: { state: true },
    _orgRepo: { state: true },
  };

  constructor() {
    super();
    this.projects = [];
    this._selectedPath = '';
    this._orgRepo = null;
  }

  _boundHashChange = () => {
    this._orgRepo = getOrgRepoFromHash();
  };

  _boundFileSelect = (e) => {
    // eslint-disable-next-line no-console
    console.log('[da-space] da-file-browser-select received', e.type, e.detail);
    const path = e.detail?.item?.path;
    this._selectedPath = typeof path === 'string' ? path.replace(/^\//, '') : '';
    // eslint-disable-next-line no-console
    console.log('[da-space] _selectedPath set to', this._selectedPath);
  };

  /* eslint-disable-next-line class-methods-use-this */
  _onWysiwygIframeLoad = () => { /* iframe loaded */ };

  _onWysiwygIframeError = () => {
    // eslint-disable-next-line no-console
    console.error('[da-space] WYSIWYG iframe error', this._wysiwygIframeSrc);
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._orgRepo = getOrgRepoFromHash();
    window.addEventListener('hashchange', this._boundHashChange);
    this.addEventListener('da-file-browser-select', this._boundFileSelect);
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this._boundHashChange);
    this.removeEventListener('da-file-browser-select', this._boundFileSelect);
    super.disconnectedCallback();
  }

  get _wysiwygIframeSrc() {
    if (!this._orgRepo || !this._selectedPath) return null;
    const { org, repo } = this._orgRepo;
    const segments = this._selectedPath.split('/');
    const pathWithoutOrgRepo = segments.slice(2).join('/');
    const pathWithoutHtml = pathWithoutOrgRepo.replace(/\.html$/i, '');
    const encodedPath = pathWithoutHtml.split('/').map(encodeURIComponent).join('/');
    return `https://main--${repo}--${org}.preview.da.live/${encodedPath}?nx=qe-img-security&quick-edit=qe-img-security`;
  }

  render() {
    const iframeSrc = this._wysiwygIframeSrc;
    return html`
      <div class="space">
        <sp-split-view
          class="split-view split-view-outer"
          resizable
          collapsible
          primary-size="230"
          secondary-min="400"
          label="Resize file browser"
        >
          <da-file-browser class="space-file-browser"></da-file-browser>
          <sp-split-view
            class="split-view split-view-inner"
            resizable
            collapsible
            primary-size="70%"
            secondary-min="320"
            label="Resize main and chat panels"
          >
            <div class="inner-primary-wrap">
              <sp-split-view
                class="split-view split-view-main"
                resizable
                collapsible
                primary-size="50%"
                secondary-min="200"
                label="Resize doc and wysiwyg panels"
              >
                <div class="main-pane main-pane-doc">
                  <span class="main-pane-label">Editor</span>
                  <div class="main-pane-doc-editor">
                    <da-inline-editor
                      .org="${this._orgRepo?.org ?? ''}"
                      .repo="${this._orgRepo?.repo ?? ''}"
                      .path="${this._selectedPath ?? ''}"
                    ></da-inline-editor>
                  </div>
                </div>
                <div class="main-pane main-pane-wysiwyg">
                  <span class="main-pane-label">WYSIWYG</span>
                  <div class="main-pane-wysiwyg-iframe-wrap">
                    ${iframeSrc
    ? html`<iframe
                          title="WYSIWYG preview"
                          src="${iframeSrc}"
                          class="main-pane-wysiwyg-iframe"
                          @load="${this._onWysiwygIframeLoad}"
                          @error="${this._onWysiwygIframeError}"
                        ></iframe>`
    : html`<div class="main-pane-wysiwyg-placeholder">
                          Select a file and set hash to <code>#/org/site</code> to preview.
                        </div>`}
                  </div>
                </div>
              </sp-split-view>
            </div>
            <da-chat class="space-chat-panel"></da-chat>
          </sp-split-view>
        </sp-split-view>
      </div>
    `;
  }
}

customElements.define('da-space', Space);
