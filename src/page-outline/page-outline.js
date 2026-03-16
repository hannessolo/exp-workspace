/**
 * Page outline: shows block structure of the currently selected page.
 * Fetches .plain.html from preview, parses main > section > block, displays with Spectrum UI.
 * Only active when a page (e.g. .html) is selected.
 */
// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const { token } = await DA_SDK;
const style = await getStyle(import.meta.url);

/**
 * Build preview origin for org/repo.
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
function previewOrigin(org, repo) {
  if (!org || !repo) return '';
  return `https://main--${repo}--${org}.preview.da.live`;
}

/**
 * True if the selected path represents a page we can load for outline (e.g. .html).
 * @param {string} selectedPath - e.g. org/repo/path/to/page.html
 * @returns {boolean}
 */
function isPagePath(selectedPath) {
  if (!selectedPath || typeof selectedPath !== 'string') return false;
  const trimmed = selectedPath.trim();
  if (!trimmed) return false;
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length < 2) return false;
  const last = segments[segments.length - 1];
  return last.toLowerCase().endsWith('.html') || last === 'index' || !last.includes('.');
}

/**
 * Parse HTML string and return list of { sectionIndex, blockName }.
 * Plain HTML structure: container (main or body) has direct div children = sections.
 * Each section has direct div children with a class = block (e.g. hero, card, section-metadata).
 * @param {string} htmlText
 * @returns {{ sectionIndex: number, blockName: string }[]}
 */
function parseBlockStructure(htmlText) {
  const blocks = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const container = doc.querySelector('main') || doc.body;
    if (!container) return blocks;

    const sections = container.querySelectorAll(':scope > div');
    sections.forEach((section, sectionIndex) => {
      section.querySelectorAll(':scope > div[class]').forEach((blockEl) => {
        const blockName = blockEl.classList[0];
        if (blockName && blockName !== 'default-content-wrapper') {
          blocks.push({ sectionIndex, blockName });
        }
      });
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[page-outline] parseBlockStructure failed', e?.message);
  }
  return blocks;
}

/**
 * Fetch .plain.html for the given path and return block structure.
 * @param {string} origin - e.g. https://main--repo--org.preview.da.live
 * @param {string} pathWithoutOrgRepo - e.g. folder/page or folder/page.html
 * @param {string} [authToken] - Bearer token for authenticated requests
 * @returns {Promise<{ sectionIndex: number, blockName: string }[]>}
 */
async function fetchBlockStructure(origin, pathWithoutOrgRepo, authToken) {
  const pathNorm = pathWithoutOrgRepo.replace(/\.html$/i, '').trim();
  if (!pathNorm) return [];
  const encoded = pathNorm.split('/').map(encodeURIComponent).join('/');
  const url = `${origin}/${encoded}.plain.html`;
  const headers = {};
  const isLocalhost = window?.location?.hostname === 'localhost';
  console.log('isLocalhost', isLocalhost);
  if (authToken && !isLocalhost) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const resp = await fetch(url, { method: 'GET', headers });
  if (!resp.ok) return [];
  const text = await resp.text();
  return parseBlockStructure(text);
}

export default class PageOutline extends LitElement {
  static properties = {
    selectedPath: { type: String },
    org: { type: String },
    repo: { type: String },
    _blocks: { state: true },
    _loading: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.selectedPath = '';
    this.org = '';
    this.repo = '';
    this._blocks = [];
    this._loading = false;
    this._error = null;
  }

  get _isPage() {
    return isPagePath(this.selectedPath);
  }

  get _pathWithoutOrgRepo() {
    if (!this.selectedPath) return '';
    const segments = this.selectedPath.replace(/^\//, '').split('/').filter(Boolean);
    return segments.slice(2).join('/');
  }

  async _loadOutline() {
    if (!this._isPage || !this.org || !this.repo) {
      this._blocks = [];
      this._error = null;
      return;
    }
    const origin = previewOrigin(this.org, this.repo);
    const pathWithoutOrgRepo = this._pathWithoutOrgRepo;
    if (!origin || !pathWithoutOrgRepo) {
      this._blocks = [];
      return;
    }
    this._loading = true;
    this._error = null;
    this.requestUpdate();
    try {
      this._blocks = await fetchBlockStructure(origin, pathWithoutOrgRepo, token);
    } catch (e) {
      this._error = e?.message || 'Failed to load outline';
      this._blocks = [];
    } finally {
      this._loading = false;
      this.requestUpdate();
    }
  }

  updated(changed) {
    super.updated?.(changed);
    if (changed.has('selectedPath') || changed.has('org') || changed.has('repo')) {
      this._loadOutline();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
  }

  render() {
    if (!this.org || !this.repo) {
      return html`
        <div class="page-outline">
          <div class="page-outline-placeholder">
            Set hash to <code>#/org/site</code> to see outline.
          </div>
        </div>
      `;
    }

    if (!this._isPage) {
      return html`
        <div class="page-outline">
          <div class="page-outline-placeholder">
            Select a page (e.g. a .html file) to view its block outline.
          </div>
        </div>
      `;
    }

    if (this._error) {
      return html`
        <div class="page-outline">
          <div class="page-outline-header">Page outline</div>
          <div class="page-outline-error" role="alert">${this._error}</div>
        </div>
      `;
    }

    if (this._loading) {
      return html`
        <div class="page-outline">
          <div class="page-outline-header">Page outline</div>
          <div class="page-outline-placeholder">Loading…</div>
        </div>
      `;
    }

    const sections = this._sectionsWithBlocks;
    return html`
<div class="page-outline">
  <div class="page-outline-header">Page outline</div>
  <div class="page-outline-list-wrap">
    ${sections.length === 0
    ? html`<div class="page-outline-placeholder">No blocks found.</div>`
    : html`
<ul class="page-outline-list" role="tree" aria-label="Page outline">
  ${sections.map((sec) => html`
<li class="page-outline-section" role="treeitem" aria-expanded="true">
  <span class="page-outline-section-label">§${sec.sectionIndex + 1}</span>
  <ul class="page-outline-block-list" role="group">
    ${sec.blocks.map((blockName) => html`
<li class="page-outline-block" role="treeitem">
  <span class="page-outline-block-name">${blockName}</span>
</li>
    `)}
  </ul>
</li>
  `)}
</ul>
      `}
  </div>
</div>
    `;
  }

  get _sectionsWithBlocks() {
    const bySection = new Map();
    this._blocks.forEach((entry) => {
      let blocks = bySection.get(entry.sectionIndex);
      if (!blocks) {
        blocks = [];
        bySection.set(entry.sectionIndex, blocks);
      }
      blocks.push(entry.blockName);
    });
    return Array.from(bySection.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sectionIndex, blocks]) => ({ sectionIndex, blocks }));
  }
}

customElements.define('da-page-outline', PageOutline);
