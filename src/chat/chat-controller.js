import { loadMessages, saveMessages, clearMessages } from './chat-idb-store.js';

function normalizePath(path) {
  if (typeof path !== 'string') return '';
  return path
    .trim()
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+/, '')
    .replace(/\.html$/i, '');
}

function getToolName(part) {
  if (typeof part?.toolName === 'string' && part.toolName) return part.toolName;
  if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.replace('tool-', '');
  }
  return '';
}

function getPathFromToolPart(part) {
  if (part?.output && typeof part.output === 'object') {
    if (typeof part.output.path === 'string') return part.output.path;
    if (typeof part.output?.data?.path === 'string') return part.output.data.path;
  }
  if (part?.input && typeof part.input === 'object' && typeof part.input.path === 'string') {
    return part.input.path;
  }
  return '';
}

function isToolOutputSuccess(part) {
  if (!part?.output || typeof part.output !== 'object') return false;
  if (part.output.error) return false;
  if ('success' in part.output) return part.output.success === true;
  return true;
}

function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function normalizeMessage(message) {
  const rawParts = Array.isArray(message?.parts) ? message.parts : [];
  const content = extractTextFromParts(rawParts)
    || (typeof message?.content === 'string' ? message.content : '');
  // When the agent sends content without parts, synthesize a text part so the
  // merge in updateAssistantFromMessage doesn't fall back to the placeholder parts.
  let parts = rawParts;
  if (rawParts.length === 0 && content) {
    parts = [{ type: 'text', text: content }];
  }
  return {
    id: message?.id,
    role: message?.role === 'user' ? 'user' : 'assistant',
    content,
    parts,
  };
}

export class ChatController {
  constructor(options = {}) {
    this.host = options.host || 'da-agent.adobeaem.workers.dev';
    this.room = options.name || 'default';
    this.getContext = options.getContext || (() => ({}));
    this.getImsToken = options.getImsToken || (() => null);

    this.onUpdate = options.onUpdate || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onConnectionChange = options.onConnectionChange || (() => {});
    this.onDocumentUpdated = options.onDocumentUpdated || (() => {});

    this.messages = [];
    this.connected = false;
    this.isThinking = false;
    this.statusText = '';

    this.activeAssistantIndex = null;
    this.processedUpdateToolCalls = new Set();
    this._abortController = null;
  }

  get _chatUrl() {
    const protocol = this.host.startsWith('localhost') ? 'http' : 'https';
    return `${protocol}://${this.host}/chat`;
  }

  connect() {
    if (this.connected) return;
    this.connected = true;
    this.statusText = 'Connected';
    this.onConnectionChange(true);
    this.onStatusChange(this.statusText);
    this.onUpdate();
    this.loadInitialMessages();
  }

  disconnect() {
    this._abortController?.abort();
    this._abortController = null;

    this.connected = false;
    this.isThinking = false;
    this.activeAssistantIndex = null;
    this.statusText = 'Disconnected';

    this.onConnectionChange(false);
    this.onStatusChange(this.statusText);
    this.onUpdate();
  }

  // ---------- stream reading ----------

  _processStreamLine(rawLine) {
    // Strip SSE "data: " prefix
    const line = rawLine.startsWith('data: ') ? rawLine.slice(6) : rawLine;
    if (!line.trim() || line === '[DONE]') return;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (!event || typeof event !== 'object') return;

    switch (event.type) {
      case 'text-delta':
        if (typeof event.delta === 'string') this.appendToActiveAssistantMessage(event.delta);
        break;
      case 'tool-call':
      case 'tool-input-available':
        this._handleToolCallStart(event);
        break;
      case 'tool-output-available':
        this._handleToolResult({ toolCallId: event.toolCallId, result: event.output });
        break;
      case 'error':
        this.isThinking = false;
        this.statusText = 'Error';
        this.onStatusChange(this.statusText);
        this.onUpdate();
        break;
      case 'finish-message':
      case 'finish':
        if (this.isThinking) {
          this.isThinking = false;
          this.statusText = 'Complete';
          this.onStatusChange(this.statusText);
          this.onUpdate();
        }
        break;
      default:
        // text-start, start-step, finish-step — no action needed
        break;
    }
  }

  async _readStream(reader) {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        lines.forEach((line) => {
          if (line.trim()) this._processStreamLine(line);
        });
      }
      if (buffer.trim()) this._processStreamLine(buffer);
    } finally {
      reader.releaseLock();
    }

    // Ensure thinking state is cleared if the stream ended without a finish event
    if (this.isThinking) {
      this.isThinking = false;
      this.statusText = 'Complete';
      this.onStatusChange(this.statusText);
      this.onUpdate();
    }
  }

  // ---------- tool call helpers ----------

  _handleToolCallStart(data) {
    if (!data || typeof data !== 'object') return;
    const { toolCallId, toolName } = data;
    if (!toolCallId) return;

    this.ensureAssistantPlaceholder();
    const idx = this.activeAssistantIndex;
    if (idx === null) return;

    const next = [...this.messages];
    const existingParts = Array.isArray(next[idx]?.parts) ? next[idx].parts : [];
    next[idx] = {
      ...next[idx],
      parts: [...existingParts, {
        type: 'tool-call',
        toolCallId,
        toolName: toolName || '',
        state: 'input-available',
      }],
    };
    this.messages = next;
    this.onUpdate();
  }

  _handleToolResult(data) {
    if (!data || typeof data !== 'object') return;
    const { toolCallId, result } = data;
    if (!toolCallId) return;

    const next = [...this.messages];
    const msgIdx = next.findIndex((msg) => (
      Array.isArray(msg.parts)
      && msg.parts.some((p) => p?.toolCallId === toolCallId)
    ));
    if (msgIdx < 0) return;

    const parts = next[msgIdx].parts.map((p) => {
      if (p?.toolCallId !== toolCallId) return p;
      return { ...p, state: 'output-available', output: result };
    });
    next[msgIdx] = { ...next[msgIdx], parts };
    this.messages = next;
    this.notifyDocumentUpdated(parts);
    this.onUpdate();
  }

  // ---------- message helpers ----------

  ensureAssistantPlaceholder() {
    if (this.activeAssistantIndex !== null) return;
    this.messages = [...this.messages, {
      role: 'assistant',
      content: '...',
      parts: [{ type: 'text', text: '...' }],
    }];
    this.activeAssistantIndex = this.messages.length - 1;
  }

  appendToActiveAssistantMessage(text) {
    if (!text) return;
    this.ensureAssistantPlaceholder();

    const idx = this.activeAssistantIndex;
    if (idx === null) return;

    const next = [...this.messages];
    const current = next[idx]?.content || '';
    const base = current === '...' ? '' : current;
    const content = `${base}${text}`;
    const existingParts = Array.isArray(next[idx]?.parts) ? next[idx].parts : [];
    let textPartUpdated = false;
    const parts = existingParts.map((part) => {
      if (!textPartUpdated && part?.type === 'text') {
        textPartUpdated = true;
        return { ...part, text: content };
      }
      return part;
    });
    if (!textPartUpdated) {
      parts.push({ type: 'text', text: content });
    }
    next[idx] = {
      ...next[idx], role: 'assistant', content, parts,
    };
    this.messages = next;
    this.onUpdate();
  }

  notifyDocumentUpdated(parts) {
    if (!Array.isArray(parts)) return;

    const context = this.getContext();
    if (context?.view !== 'edit') return;
    const currentPath = normalizePath(context.path || '');
    if (!currentPath) return;

    parts.forEach((part) => {
      if (!part || typeof part !== 'object') return;
      if (part.state !== 'output-available') return;

      const toolName = getToolName(part);
      if (toolName !== 'da_update_source') return;
      if (!isToolOutputSuccess(part)) return;

      const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : '';
      if (toolCallId && this.processedUpdateToolCalls.has(toolCallId)) return;

      const targetPath = normalizePath(getPathFromToolPart(part));
      if (!targetPath || targetPath !== currentPath) return;

      if (toolCallId) this.processedUpdateToolCalls.add(toolCallId);

      this.onDocumentUpdated({ toolName, toolCallId, path: targetPath });
    });
  }

  syncMessagesFromAgent(agentMessages) {
    const nextMessages = [];

    agentMessages.forEach((message) => {
      const normalized = normalizeMessage(message);
      if (!normalized.content && normalized.parts.length === 0) return;
      nextMessages.push(normalized);
    });

    this.messages = nextMessages;
    this.activeAssistantIndex = null;
    this.onUpdate();
  }

  toAgentMessages() {
    return this.messages
      .filter((message) => (
        (
          typeof message.content === 'string'
          && message.content.trim().length > 0
          && message.content !== '...'
        )
        || extractTextFromParts(message.parts).trim().length > 0
      ))
      .map((message, index) => {
        const textContent = message.content
          || extractTextFromParts(message.parts)
          || '';
        const parts = Array.isArray(message.parts) && message.parts.length > 0
          ? message.parts
          : [{ type: 'text', text: textContent }];
        return {
          id: message.id || `da-local-${index}`,
          role: message.role,
          content: textContent,
          parts,
        };
      });
  }

  // ---------- public API ----------

  async sendMessage(text) {
    const content = (text || '').trim();
    if (!content || this.isThinking || !this.connected) return;

    this.messages = [...this.messages, {
      role: 'user',
      content,
      parts: [{ type: 'text', text: content }],
    }];
    this.isThinking = true;
    this.statusText = 'Thinking...';
    this.activeAssistantIndex = null;

    // Collect messages BEFORE adding the assistant placeholder so the agent
    // never receives a conversation that ends with the '...' placeholder.
    const agentMessages = this.toAgentMessages();
    const pageContext = this.getContext();
    // eslint-disable-next-line no-console
    console.debug('[da-chat] sending request, messages:', JSON.stringify(agentMessages), 'context:', pageContext);

    this.ensureAssistantPlaceholder();
    this.onStatusChange(this.statusText);
    this.onUpdate();

    this._abortController = new AbortController();

    try {
      const response = await fetch(this._chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: agentMessages,
          pageContext,
          imsToken: this.getImsToken(),
          room: this.room,
        }),
        signal: this._abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await this._readStream(response.body.getReader());
      saveMessages(this.room, this.messages);
    } catch (e) {
      if (e.name === 'AbortError') return;
      this.isThinking = false;
      this.statusText = 'Error';
      const errorText = `Error: ${e.message || 'Failed to send message'}`;
      this.messages = [...this.messages, {
        role: 'assistant',
        content: errorText,
        parts: [{ type: 'text', text: errorText }],
      }];
      saveMessages(this.room, this.messages);
      this.onStatusChange(this.statusText);
      this.onUpdate();
    } finally {
      this._abortController = null;
    }
  }

  stop() {
    this._abortController?.abort();
    this._abortController = null;
    this.isThinking = false;
    this.statusText = 'Stopped';
    this.onStatusChange(this.statusText);
    this.onUpdate();
  }

  clearHistory() {
    this._abortController?.abort();
    this._abortController = null;
    clearMessages(this.room);
    this.messages = [];
    this.activeAssistantIndex = null;
    this.isThinking = false;
    this.statusText = '';
    this.processedUpdateToolCalls.clear();
    this.onStatusChange(this.statusText);
    this.onUpdate();
  }

  async loadInitialMessages() {
    let serverLoaded = false;
    try {
      const response = await fetch(`${this._chatUrl}/messages`, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          const messages = JSON.parse(text);
          if (Array.isArray(messages) && messages.length > 0) {
            this.syncMessagesFromAgent(messages);
            saveMessages(this.room, this.messages);
            serverLoaded = true;
          }
        }
      }
    } catch {
      // Ignore server load failures, fall through to IDB.
    }

    if (!serverLoaded) {
      try {
        const cached = await loadMessages(this.room);
        if (cached.length > 0) this.syncMessagesFromAgent(cached);
      } catch {
        // IDB also unavailable — start with empty history.
      }
    }
  }

  findToolCallIdByApprovalId(approvalId) {
    if (!approvalId) return null;

    const found = this.messages.reduce((acc, message) => {
      if (acc) return acc;
      if (!Array.isArray(message.parts)) return acc;
      const matchedPart = message.parts.find(
        (part) => part
          && typeof part === 'object'
          && part.toolCallId
          && part.approval
          && part.approval.id === approvalId,
      );
      return matchedPart ? matchedPart.toolCallId : acc;
    }, null);

    return found;
  }

  // eslint-disable-next-line class-methods-use-this
  addToolApprovalResponse({ id, approved }) {
    // Tool approval requires a separate HTTP endpoint; not yet implemented.
    // eslint-disable-next-line no-console
    console.debug('[da-chat] addToolApprovalResponse: not supported over HTTP yet', { id, approved });
  }
}

export default ChatController;
