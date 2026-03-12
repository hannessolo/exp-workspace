// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';
// eslint-disable-next-line import/no-unresolved
import '../../src/chat/chat.js';
// eslint-disable-next-line import/no-unresolved
import '../../src/file-browser/file-browser.js';
import '../../src/page-outline/page-outline.js';
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
    _sidebarTab: { state: true },
    _viewMode: { state: true },
    _chatOpen: { state: true },
    _detailsOpen: { state: true },
  };

  constructor() {
    super();
    this.projects = [];
    this._selectedPath = '';
    this._orgRepo = null;
    this._sidebarTab = 'files';
    this._viewMode = 'split';
    this._chatOpen = true;
    this._detailsOpen = true;
  }

  _boundHashChange = () => {
    this._orgRepo = getOrgRepoFromHash();
    const hash = window.location.hash || '';
    const path = hash.replace(/^#\/?/, '').trim();
    const pathSegments = path ? path.split('/').filter(Boolean) : [];
    this._selectedPath = pathSegments.length > 2 ? path : '';
  };

  _boundFileSelect = (e) => {
    const path = e.detail?.item?.path;
    this._selectedPath = typeof path === 'string' ? path.replace(/^\//, '') : '';
  };

  _onViewModeChange = (e) => {
    const { selected } = e.target;
    const value = Array.isArray(selected) && selected.length > 0 ? selected[0] : 'split';
    if (value === 'doc' || value === 'wysiwyg' || value === 'split') {
      this._viewMode = value;
    }
  };

  _onBreadcrumbFolderClick(pathKey) {
    this._detailsOpen = true;
    this._sidebarTab = 'files';
    const hash = pathKey.startsWith('/') ? pathKey : `/${pathKey}`;
    window.location.hash = `#${hash}`;
  }

  get _breadcrumbSegments() {
    if (this._selectedPath) {
      return this._selectedPath.split('/').filter(Boolean);
    }
    if (this._orgRepo) {
      return [this._orgRepo.org, this._orgRepo.repo];
    }
    return [];
  }

  /* eslint-disable-next-line class-methods-use-this */
  _onWysiwygIframeLoad = () => { /* iframe loaded */ };

  _onWysiwygIframeError = () => {
    // eslint-disable-next-line no-console
    console.error('[da-space] WYSIWYG iframe error', this._wysiwygIframeSrc);
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._boundHashChange();
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

  _renderDocPane() {
    return html`
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
    `;
  }

  _renderWysiwygPane(iframeSrc) {
    return html`
      <div class="main-pane main-pane-wysiwyg">
        <span class="main-pane-label">WYSIWYG</span>
        <div class="main-pane-wysiwyg-iframe-wrap">
          ${iframeSrc ? html`<iframe
            title="WYSIWYG preview"
            src="${iframeSrc}"
            class="main-pane-wysiwyg-iframe"
            @load="${this._onWysiwygIframeLoad}"
            @error="${this._onWysiwygIframeError}"
          ></iframe>` : html`<div class="main-pane-wysiwyg-placeholder">
            Select a file and set hash to <code>#/org/site</code> to preview.
          </div>`}
        </div>
      </div>
    `;
  }

  _renderMiddleContent(iframeSrc) {
    if (this._viewMode === 'doc') {
      return html`<div class="main-single-pane">${this._renderDocPane()}</div>`;
    }
    if (this._viewMode === 'wysiwyg') {
      return html`<div class="main-single-pane">${this._renderWysiwygPane(iframeSrc)}</div>`;
    }
    return html`
      <sp-split-view
        class="split-view split-view-main"
        resizable
        primary-size="40%"
        secondary-min="200"
        label="Resize doc and wysiwyg panels"
      >
        ${this._renderDocPane()}
        ${this._renderWysiwygPane(iframeSrc)}
      </sp-split-view>
    `;
  }

  /* eslint-disable-next-line class-methods-use-this */
  _renderPlayIcon() {
    return html`
      <svg class="space-nav-icon" slot="icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
    `;
  }

  _renderPublishMenu() {
    return html`
      <sp-action-menu label="Publish menu" class="space-publish-menu-trigger">
        ${this._renderPlayIcon()}
        <sp-menu-item>Preview</sp-menu-item>
        <sp-menu-item>Publish</sp-menu-item>
      </sp-action-menu>
    `;
  }

  _renderBreadcrumbCrumb(name, pathKey, isOrgOrRepo, isFolder) {
    if (isOrgOrRepo) {
      return html`<span class="space-breadcrumb-crumb space-breadcrumb-disabled">${name}</span>`;
    }
    if (isFolder) {
      return html`
        <button
          type="button"
          class="space-breadcrumb-crumb space-breadcrumb-link"
          @click="${() => this._onBreadcrumbFolderClick(pathKey)}"
        >${name}</button>
      `;
    }
    return html`<span class="space-breadcrumb-crumb space-breadcrumb-current">${name}</span>`;
  }

  _renderBreadcrumbs() {
    const segments = this._breadcrumbSegments;
    if (segments.length === 0) {
      return html`<nav class="space-breadcrumbs" aria-label="File path"></nav>`;
    }
    return html`
      <nav class="space-breadcrumbs" aria-label="File path">
        ${segments.map((name, i) => {
    const pathKey = segments.slice(0, i + 1).join('/');
    const isOrgOrRepo = i < 2;
    const isLast = i === segments.length - 1;
    const isFolder = !isLast;
    return html`
      <span class="space-breadcrumb-segment">
        ${i > 0 ? html`<span class="space-breadcrumb-sep" aria-hidden="true">/</span>` : ''}
        ${this._renderBreadcrumbCrumb(name, pathKey, isOrgOrRepo, isFolder)}
      </span>
    `;
  })}
      </nav>
    `;
  }

  _renderInnerSplit(iframeSrc) {
    if (!this._detailsOpen) {
      return html`
        <div class="inner-primary-wrap">
          ${this._renderMiddleContent(iframeSrc)}
        </div>
      `;
    }
    return html`
      <sp-split-view
        class="split-view split-view-inner"
        resizable
        primary-size="70%"
        secondary-min="200"
        label="Resize main and details panels"
      >
        <div class="inner-primary-wrap">
          ${this._renderMiddleContent(iframeSrc)}
        </div>
        <div class="space-details">
          <div class="space-details-tablist" role="tablist" aria-label="Details">
            <button
              type="button"
              role="tab"
              class="space-details-tab"
              aria-selected="${this._sidebarTab === 'files'}"
              aria-controls="space-details-panel-files"
              id="space-details-tab-files"
              @click="${() => { this._sidebarTab = 'files'; }}"
            >Files</button>
            <button
              type="button"
              role="tab"
              class="space-details-tab"
              aria-selected="${this._sidebarTab === 'outline'}"
              aria-controls="space-details-panel-outline"
              id="space-details-tab-outline"
              @click="${() => { this._sidebarTab = 'outline'; }}"
            >Outline</button>
          </div>
          <div
            id="space-details-panel-files"
            role="tabpanel"
            aria-labelledby="space-details-tab-files"
            class="space-details-panel"
            ?hidden="${this._sidebarTab !== 'files'}"
          >
            <da-file-browser class="space-file-browser"></da-file-browser>
          </div>
          <div
            id="space-details-panel-outline"
            role="tabpanel"
            aria-labelledby="space-details-tab-outline"
            class="space-details-panel"
            ?hidden="${this._sidebarTab !== 'outline'}"
          >
            <da-page-outline
              class="space-page-outline"
              .selectedPath="${this._selectedPath ?? ''}"
              .org="${this._orgRepo?.org ?? ''}"
              .repo="${this._orgRepo?.repo ?? ''}"
            ></da-page-outline>
          </div>
        </div>
      </sp-split-view>
    `;
  }

  render() {
    const iframeSrc = this._wysiwygIframeSrc;
    return html`
      <div class="space">
        <nav class="space-top-nav" aria-label="Toolbar">
          <div class="space-nav-left">
            ${this._renderBreadcrumbs()}
          </div>
          <div class="space-nav-center">
            <sp-action-button
              class="space-nav-toggle-btn"
              label="Toggle chat panel"
              ?selected="${this._chatOpen}"
              @click="${() => { this._chatOpen = !this._chatOpen; }}"
            >
              <img src="/icons/aichat.svg" slot="icon" alt="" class="space-nav-icon" />
            </sp-action-button>
            <sp-action-group
              class="space-nav-action-group"
              compact
              selects="single"
              label="Middle panel view"
              .selected="${[this._viewMode]}"
              @change="${this._onViewModeChange}"
            >
              <sp-action-button value="doc" label="Doc">
                <img src="/icons/file.svg" slot="icon" alt="" class="space-nav-icon" />
              </sp-action-button>
              <sp-action-button value="wysiwyg" label="WYSIWYG">
                <img src="/icons/wysiwyg.svg" slot="icon" alt="" class="space-nav-icon" />
              </sp-action-button>
              <sp-action-button value="split" label="Split">
                <img src="/icons/split.svg" slot="icon" alt="" class="space-nav-icon" />
              </sp-action-button>
            </sp-action-group>
            <sp-action-button
              class="space-nav-toggle-btn"
              label="Toggle details panel"
              ?selected="${this._detailsOpen}"
              @click="${() => { this._detailsOpen = !this._detailsOpen; }}"
            >
              <img src="/icons/details.svg" slot="icon" alt="" class="space-nav-icon" />
            </sp-action-button>
          </div>
          <div class="space-nav-right">
            ${this._renderPublishMenu()}
          </div>
        </nav>
        <div class="space-body">
          ${this._chatOpen ? html`
          <sp-split-view
            class="split-view split-view-outer"
            resizable
            primary-size="25%"
            primary-min="280"
            secondary-min="400"
            label="Resize chat panel"
          >
            <da-chat class="space-chat-panel"></da-chat>
            ${this._renderInnerSplit(iframeSrc)}
          </sp-split-view>
          ` : this._renderInnerSplit(iframeSrc)}
        </div>
      </div>
    `;
  }
}

customElements.define('da-space', Space);
