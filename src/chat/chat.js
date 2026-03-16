// eslint-disable-next-line import/no-unresolved
import getStyle from 'https://da.live/nx/utils/styles.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html } from 'da-lit';
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-named-as-default
import ChatController from './chat-controller.js';

const style = await getStyle(import.meta.url);
const { token } = await DA_SDK;

const DOCUMENT_UPDATED_EVENT = 'da:agent-content-updated';

function getContextFromHash() {
  const hash = window.location.hash || '';
  const path = hash.replace(/^#\/?/, '').trim();
  const segments = path ? path.split('/').filter(Boolean) : [];
  const [org = '', repo = '', ...rest] = segments;
  return {
    org,
    site: repo,
    path: rest.join('/'),
    view: 'edit',
  };
}

/**
 * Chat panel component with real AI agent connection.
 * Self-contained: reads org/repo/path from the URL hash and IMS token from DA_SDK.
 * @fires da:agent-content-updated - when the agent updates the document
 */
class Chat extends LitElement {
  static properties = {
    header: { type: String },
    _connected: { state: true },
    _messages: { state: true },
    _inputValue: { state: true },
    _isThinking: { state: true },
    _statusText: { state: true },
    _skillsLibraryTab: { state: true },
  };

  constructor() {
    super();
    this.header = 'Assistant';
    this._connected = false;
    this._messages = [];
    this._inputValue = '';
    this._isThinking = false;
    this._statusText = '';
    this._skillsLibraryTab = 'skills';
    this._chatController = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._ensureController();
    this._chatController?.connect();
  }

  disconnectedCallback() {
    this._chatController?.disconnect();
    super.disconnectedCallback();
  }

  _ensureController() {
    if (this._chatController) return;

    // Use a unique room per project so the Durable Object instance is isolated
    // and doesn't accumulate stale history from other users / sessions.
    const { org, site } = getContextFromHash();
    const agentRoom = org && site ? `${org}--${site}` : 'default';

    this._chatController = new ChatController({
      host: 'da-agent.adobeaem.workers.dev',
      name: agentRoom,
      getContext: getContextFromHash,
      getImsToken: () => token,
      onUpdate: () => {
        this._messages = [...this._chatController.messages];
        this._isThinking = this._chatController.isThinking;
        this._scrollMessagesToBottom();
      },
      onStatusChange: (statusText) => {
        this._statusText = statusText || '';
      },
      onConnectionChange: (connected) => {
        this._connected = connected;
      },
      onDocumentUpdated: (payload) => {
        window.dispatchEvent(new CustomEvent(DOCUMENT_UPDATED_EVENT, {
          detail: { ...payload, ts: Date.now() },
        }));
      },
    });
  }

  _scrollMessagesToBottom() {
    this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector('.chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  _handleInput(e) {
    this._inputValue = e.target.value;
  }

  _handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._sendMessage();
    }
  }

  _sendMessage() {
    const content = this._inputValue.trim();
    if (!content || this._isThinking || !this._chatController) return;
    this._inputValue = '';
    this._chatController.sendMessage(content);
  }

  _stopRequest() {
    this._chatController?.stop();
  }

  _clearChat() {
    this._chatController?.clearHistory();
  }

  _sendToolApproval(id, approved) {
    if (!id || !this._chatController) return;
    this._chatController.addToolApprovalResponse({ id, approved });
  }

  _sendPrompt(prompt) {
    if (!prompt || this._isThinking || !this._connected) return;
    this._chatController?.sendMessage(prompt);
  }

  // eslint-disable-next-line class-methods-use-this
  _getToolName(part) {
    if (typeof part?.toolName === 'string' && part.toolName) return part.toolName;
    if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
      return part.type.replace('tool-', '');
    }
    return 'Tool';
  }

  // eslint-disable-next-line class-methods-use-this
  _isToolPart(part) {
    if (!part || typeof part !== 'object') return false;
    return !!(
      part.type === 'dynamic-tool'
      || part.type === 'tool'
      || (typeof part.type === 'string' && part.type.startsWith('tool-'))
      || part.toolCallId
      || part.approval
    );
  }

  _onSkillsNavChange(e) {
    const { value } = e.target;
    if (value) this._skillsLibraryTab = value;
  }

  _renderToolPart(part) {
    if (!this._isToolPart(part)) return '';
    const toolName = this._getToolName(part);

    if (
      part.approval
      && (
        part.state === 'approval-requested'
        || typeof part.approval.approved === 'undefined'
      )
    ) {
      const approvalId = part.approval?.id;
      return html`
        <div class="message-row assistant">
          <div class="message-bubble approval-bubble">
            <div class="approval-title"><strong>Approval needed:</strong> ${toolName}</div>
            <div class="approval-actions">
              <sp-button
                variant="accent"
                size="s"
                ?disabled=${!approvalId || this._isThinking}
                @click=${() => this._sendToolApproval(approvalId, true)}
              >Approve</sp-button>
              <sp-button
                variant="negative"
                size="s"
                ?disabled=${!approvalId || this._isThinking}
                @click=${() => this._sendToolApproval(approvalId, false)}
              >Reject</sp-button>
            </div>
          </div>
        </div>
      `;
    }

    if (part.state === 'output-denied' || part.approval?.approved === false) {
      return html`
        <div class="message-row assistant">
          <div class="message-bubble tool-bubble">
            <strong>${toolName}</strong>: Rejected
          </div>
        </div>
      `;
    }

    if (part.state === 'output-available') {
      return html`
        <div class="message-row assistant">
          <div class="message-bubble tool-bubble">
            <strong>${toolName}</strong>: Done
          </div>
        </div>
      `;
    }

    if (part.state === 'input-available' || part.state === 'input-streaming') {
      return html`
        <div class="message-row assistant">
          <div class="message-bubble tool-bubble">
            Running ${toolName}…
          </div>
        </div>
      `;
    }

    return '';
  }

  _renderWelcome() {
    const prompts = [
      'Summarize this page',
      'Suggest better headings',
      'Improve clarity and tone',
      'Find accessibility issues',
    ];

    return html`
      <div class="chat-empty-state">
        <div class="chat-empty-title">Start a conversation</div>
        <div class="chat-empty-actions">
          ${prompts.map((prompt) => html`
            <button
              class="chat-welcome-btn"
              ?disabled=${this._isThinking || !this._connected}
              @click=${() => this._sendPrompt(prompt)}
            >
              ${prompt}
            </button>
          `)}
        </div>
      </div>
    `;
  }

  _renderSkillsBar() {
    return html`
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
    `;
  }

  render() {
    return html`
      <div class="chat">
        <div class="chat-header">
          <span class="chat-header-title">${this.header}</span>
          <div class="chat-header-actions">
            <span class="status-pill ${this._connected ? 'connected' : 'disconnected'}">
              ${this._connected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              class="chat-clear-btn"
              @click=${this._clearChat}
              title="Clear chat"
              aria-label="Clear chat"
            >×</button>
          </div>
        </div>

        <div class="chat-messages" role="log" aria-live="polite">
          ${this._messages.length === 0 ? this._renderWelcome() : ''}
          ${this._messages.map((message, index) => html`
            <div class="message-group" data-message-index=${index}>
              ${Array.isArray(message.parts) ? message.parts.map((part) => this._renderToolPart(part)) : ''}
              ${Array.isArray(message.parts)
    ? message.parts
      .filter((part) => part?.type === 'text' && typeof part.text === 'string' && part.text)
      .map((part) => html`
                    <div class="message-row ${message.role}">
                      <div class="message-bubble">${part.text}</div>
                    </div>
                  `)
    : ''}
              ${message.content
    && (!Array.isArray(message.parts)
      || !message.parts.some((p) => p?.type === 'text' && p.text))
    ? html`
                  <div class="message-row ${message.role}">
                    <div class="message-bubble">${message.content}</div>
                  </div>
                `
    : ''}
            </div>
          `)}
        </div>

        ${this._renderSkillsBar()}

        <div class="chat-footer">
          <sp-textfield
            class="chat-input"
            label="Message"
            placeholder="Send a message..."
            .value=${this._inputValue}
            ?disabled=${this._isThinking || !this._connected}
            @input=${this._handleInput}
            @keydown=${this._handleKeyDown}
          ></sp-textfield>
          ${this._isThinking
    ? html`<sp-button variant="secondary" @click=${this._stopRequest}>Stop</sp-button>`
    : html`<sp-button
                variant="accent"
                ?disabled=${!this._inputValue.trim() || !this._connected}
                @click=${this._sendMessage}
              >Send</sp-button>`}
        </div>

        <div class="chat-status">${this._statusText}</div>
      </div>
    `;
  }
}

customElements.define('da-chat', Chat);
