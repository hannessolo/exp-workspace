// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';

const style = await getStyle(import.meta.url);

/**
 * Chat panel component: header, scrollable messages, input + send button.
 * Use from any host (e.g. space) by placing <da-chat></da-chat>.
 * @fires da-chat-send - when user sends a message (detail: { text: string })
 */
class Chat extends LitElement {
  static properties = {
    message: { type: String },
    messages: { type: Array },
    header: { type: String },
    _skillsLibraryTab: { state: true },
  };

  constructor() {
    super();
    this.message = '';
    this.messages = [];
    this.header = 'Chat';
    this._skillsLibraryTab = 'skills';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
  }

  onInput(e) {
    this.message = e.target.value;
  }

  onSend() {
    if (!this.message.trim()) return;
    const text = this.message.trim();
    this.messages = [...this.messages, { text, self: true }];
    this.message = '';
    this.requestUpdate();
    const field = this.shadowRoot.querySelector('#chat-input');
    if (field) field.value = '';
    this.dispatchEvent(new CustomEvent('da-chat-send', { detail: { text }, bubbles: true }));
  }

  updated(changed) {
    if (changed.has('messages')) {
      this.shadowRoot.querySelector('.chat-messages')?.scrollTo({
        top: 99999,
        behavior: 'smooth',
      });
    }
  }

  onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.onSend();
    }
  }

  _onSkillsNavChange(e) {
    const value = e.target?.value;
    if (value) this._skillsLibraryTab = value;
  }

  render() {
    return html`
      <div class="chat">
        <div class="chat-header">${this.header}</div>
        <div class="chat-messages" role="log" aria-live="polite">
          ${this.messages.length === 0
    ? html`<div class="chat-empty">No messages yet.</div>`
    : this.messages.map(
      (m) => html`
                  <div class="chat-message ${m.self ? 'chat-message-self' : ''}">
                    ${m.text}
                  </div>
                `,
    )}
        </div>
        <div class="chat-skills-bar">
          <overlay-trigger type="modal" triggered-by="click">
            <sp-dialog-wrapper slot="click-content" headline="Skills library" dismissable underlay>
              <div class="chat-skills-modal-body">
                <sp-sidenav
                  class="chat-skills-sidenav"
                  .value="${this._skillsLibraryTab}"
                  @change="${this._onSkillsNavChange}"
                >
                  <sp-sidenav-item value="skills" label="Skills" ?selected="${this._skillsLibraryTab === 'skills'}"></sp-sidenav-item>
                  <sp-sidenav-item value="mcp" label="MCP" ?selected="${this._skillsLibraryTab === 'mcp'}"></sp-sidenav-item>
                  <sp-sidenav-item value="agents" label="Agents" ?selected="${this._skillsLibraryTab === 'agents'}"></sp-sidenav-item>
                </sp-sidenav>
                <div class="chat-skills-content">
                  <div class="chat-skills-empty">
                    <svg class="chat-skills-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <path d="M2 12h4v8H2zM10 6h4v14h-4zM18 2h4v20h-4z"/>
                    </svg>
                    <p class="chat-skills-empty-text">Nothing here yet.</p>
                  </div>
                </div>
              </div>
            </sp-dialog-wrapper>
            <sp-button slot="trigger" variant="secondary" size="s">Skills library</sp-button>
          </overlay-trigger>
        </div>
        <div class="chat-footer">
          <sp-textfield
            id="chat-input"
            class="chat-input"
            label="Message"
            placeholder="Type a message..."
            value="${this.message}"
            @input="${this.onInput}"
            @keydown="${this.onKeydown}"
          ></sp-textfield>
          <sp-button variant="accent" @click="${this.onSend}">Send</sp-button>
        </div>
      </div>
    `;
  }
}

customElements.define('da-chat', Chat);
