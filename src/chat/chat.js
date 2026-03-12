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
  };

  constructor() {
    super();
    this.message = '';
    this.messages = [];
    this.header = 'Chat';
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
