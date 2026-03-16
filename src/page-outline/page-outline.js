/**
 * Page outline: shows block structure of the currently selected page.
 * Driven by editor-provided AEM HTML (prose2aem output); parses main > section > block.
 * Only active when a page (e.g. .html) is selected.
 */
// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';

const style = await getStyle(import.meta.url);

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

export default class PageOutline extends LitElement {
  static properties = {
    selectedPath: { type: String },
    org: { type: String },
    repo: { type: String },
    plainHtml: { type: String },
    _blocks: { state: true },
  };

  constructor() {
    super();
    this.selectedPath = '';
    this.org = '';
    this.repo = '';
    this.plainHtml = '';
    this._blocks = [];
  }

  get _isPage() {
    return isPagePath(this.selectedPath);
  }

  updated(changed) {
    super.updated?.(changed);
    if (changed.has('plainHtml')) {
      this._blocks = this.plainHtml?.trim()
        ? parseBlockStructure(this.plainHtml)
        : [];
      this.requestUpdate();
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
