import { loadMessages, saveMessages, clearMessages } from './chat-idb-store.js';

// Tools that require explicit user approval before execution.
const APPROVAL_REQUIRED_TOOLS = new Set([
  'da_create_source',
  'da_update_source',
  'da_delete_source',
  'da_move_content',
]);

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
  // Tool-result messages have an array content — preserve them as-is.
  if (message?.role === 'tool') {
    return {
      id: message?.id,
      role: 'tool',
      content: Array.isArray(message.content) ? message.content : [],
      parts: [],
    };
  }
  const rawParts = Array.isArray(message?.parts) ? message.parts : [];
  const content = extractTextFromParts(rawParts)
    || (typeof message?.content === 'string' ? message.content : '');
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
    const isLocal = new URLSearchParams(window.location.search).get('ref') === 'local';
    this.host = options.host || (isLocal ? 'localhost:5173' : 'da-agent.adobeaem.workers.dev');
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
    this.isAwaitingApproval = false;
    this.statusText = '';

    this.activeAssistantIndex = null;
    this.processedUpdateToolCalls = new Set();
    this._pendingApprovalIds = new Set();
    this._abortController = null;
    this._pendingOnPageContextItems = null;
  }

  get _chatUrl() {
    const protocol = this.host.startsWith('localhost') ? 'http' : 'https';
    return `${protocol}://${this.host}/chat`;
  }

  async connect() {
    if (this.connected) return;

    try {
      // Any HTTP response means the server is reachable; only a network error means it isn't.
      await fetch(this._chatUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      this.connected = true;
      this.statusText = 'Connected';
    } catch {
      this.connected = false;
      this.statusText = 'Disconnected';
    }

    this.onConnectionChange(this.connected);
    this.onStatusChange(this.statusText);
    this.onUpdate();

    if (this.connected) this.loadInitialMessages();
  }

  disconnect() {
    this._abortController?.abort();
    this._abortController = null;

    this.connected = false;
    this.isThinking = false;
    this.isAwaitingApproval = false;
    this._pendingApprovalIds.clear();
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
      case 'text-delta': {
        const delta = event.delta ?? event.textDelta ?? event.text;
        if (typeof delta === 'string') this.appendToActiveAssistantMessage(delta);
        break;
      }
      case 'tool-call':
      case 'tool-input-available':
        this._handleToolCallStart(event);
        break;
      case 'tool-approval-request':
        this._handleToolApprovalRequest(event);
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
          if (this._pendingApprovalIds.size > 0) {
            this.isAwaitingApproval = true;
            this.statusText = 'Approval required';
          } else {
            this.statusText = 'Complete';
          }
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

    // Fallback: clear thinking state if no finish event arrived
    if (this.isThinking) {
      this.isThinking = false;
      if (this._pendingApprovalIds.size > 0) {
        this.isAwaitingApproval = true;
        this.statusText = 'Approval required';
      } else {
        this.statusText = 'Complete';
      }
      this.onStatusChange(this.statusText);
      this.onUpdate();
    }
  }

  // ---------- tool call helpers ----------

  _handleToolCallStart(data) {
    if (!data || typeof data !== 'object') return;
    const {
      toolCallId, toolName, args, input,
    } = data;
    if (!toolCallId) return;

    const needsApproval = APPROVAL_REQUIRED_TOOLS.has(toolName);
    if (needsApproval) this._pendingApprovalIds.add(toolCallId);

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
        state: needsApproval ? 'approval-requested' : 'input-available',
        args: args ?? input ?? null,
        // approvalId may come from the server; fall back to toolCallId for client-gated tools.
        approval: needsApproval ? { id: data.approvalId || toolCallId } : undefined,
      }],
    };
    this.messages = next;
    this.onUpdate();
  }

  _handleToolApprovalRequest(event) {
    if (!event || typeof event !== 'object') return;

    // Support both flat format (toolCallId/toolName at event top level, as sent by da-agent)
    // and legacy nested toolCall format.
    const nested = event.toolCall || {};
    const toolCallId = event.toolCallId || nested.toolCallId || event.approvalId;
    const toolName = event.toolName || nested.toolName || '';
    const approvalId = event.approvalId || toolCallId;
    const args = event.input ?? event.args ?? nested.input ?? nested.args ?? null;

    if (!toolCallId) return;

    this._pendingApprovalIds.add(toolCallId);

    // If a tool-call part already exists (created by _handleToolCallStart on tool-input-available),
    // just update it with the real approvalId rather than creating a duplicate.
    const next = [...this.messages];
    const msgIdx = next.findIndex((msg) => (
      Array.isArray(msg.parts) && msg.parts.some((p) => p?.toolCallId === toolCallId)
    ));
    if (msgIdx >= 0) {
      next[msgIdx] = {
        ...next[msgIdx],
        parts: next[msgIdx].parts.map((p) => (
          p?.toolCallId === toolCallId
            ? { ...p, state: 'approval-requested', approval: { id: approvalId } }
            : p
        )),
      };
      this.messages = next;
      this.onUpdate();
      return;
    }

    // No existing part — create one (fallback if tool-input-available wasn't received).
    this.ensureAssistantPlaceholder();
    const idx = this.activeAssistantIndex;
    if (idx === null) return;

    const existingParts = Array.isArray(this.messages[idx]?.parts) ? this.messages[idx].parts : [];
    this.messages = [
      ...this.messages.slice(0, idx),
      {
        ...this.messages[idx],
        parts: [...existingParts, {
          type: 'tool-call',
          toolCallId,
          toolName,
          state: 'approval-requested',
          args,
          approval: { id: approvalId },
        }],
      },
      ...this.messages.slice(idx + 1),
    ];
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
      if (message?.role === 'tool') {
        if (Array.isArray(message.content) && message.content.length > 0) {
          nextMessages.push({
            id: message?.id, role: 'tool', content: message.content, parts: [],
          });
        }
        return;
      }
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
      .filter((message) => {
        if (message.role === 'tool') return true;
        const text = extractTextFromParts(message.parts) || message.content || '';
        const hasTool = Array.isArray(message.parts) && message.parts.some((p) => p?.toolCallId);
        return hasTool || (text.trim().length > 0 && text.trim() !== '...');
      })
      .map((message, index) => {
        // Tool messages (results, approval responses): pass content array through unchanged.
        if (message.role === 'tool') {
          return {
            id: message.id || `da-local-${index}`,
            role: 'tool',
            content: message.content,
          };
        }

        const textContent = extractTextFromParts(message.parts) || message.content || '';
        const toolParts = Array.isArray(message.parts)
          ? message.parts.filter((p) => p?.toolCallId)
          : [];

        // Assistant messages with tool calls: build a content array the server can process.
        // The server reads `call.input` to get tool args, and matches approvals by
        // finding `tool-approval-request` parts with the matching approvalId.
        if (toolParts.length > 0) {
          const contentParts = [];
          if (textContent && textContent.trim() && textContent.trim() !== '...') {
            contentParts.push({ type: 'text', text: textContent });
          }
          toolParts.forEach((p) => {
            contentParts.push({
              type: 'tool-call',
              toolCallId: p.toolCallId,
              toolName: p.toolName || '',
              input: p.args ?? {},
            });
            // Include approval-request so the server can match the approval response.
            if (p.approval?.id) {
              contentParts.push({
                type: 'tool-approval-request',
                approvalId: p.approval.id,
                toolCallId: p.toolCallId,
              });
            }
          });
          return {
            id: message.id || `da-local-${index}`,
            role: 'assistant',
            content: contentParts,
          };
        }

        // Text-only assistant/user message.
        return {
          id: message.id || `da-local-${index}`,
          role: message.role,
          content: textContent,
        };
      });
  }

  injectOnPageContext(agentMessages) {
    const pendingItems = this._pendingOnPageContextItems;
    this._pendingOnPageContextItems = null;
    if (!Array.isArray(pendingItems) || pendingItems.length === 0) return agentMessages;

    const contextPrefix = 'The user has selected the following items on the page as additional context to their request:';
    const contextText = `${contextPrefix}\n${JSON.stringify(pendingItems, null, 2)}`;
    const systemMessage = {
      id: 'da-on-page-context',
      role: 'system',
      content: contextText,
      parts: [{ type: 'text', text: contextText }],
    };
    const lastIdx = agentMessages.length - 1;
    const before = agentMessages.slice(0, lastIdx);
    const after = agentMessages.slice(lastIdx);
    return [...before, systemMessage, ...after];
  }

  // ---------- public API ----------

  async sendMessage(text, onPageContextItems = []) {
    const content = (text || '').trim();
    if (!content || this.isThinking || this.isAwaitingApproval || !this.connected) return;

    const hasContextItems = Array.isArray(onPageContextItems) && onPageContextItems.length > 0;
    this._pendingOnPageContextItems = hasContextItems ? onPageContextItems : null;

    this.messages = [...this.messages, {
      role: 'user',
      content,
      parts: [{ type: 'text', text: content }],
    }];
    this.isThinking = true;
    this.statusText = 'Thinking...';
    this.activeAssistantIndex = null;

    await this._resumeWithMessages();
  }

  async approveToolCall({ toolCallId, approved }) {
    if (!this._pendingApprovalIds.has(toolCallId)) return;
    this._pendingApprovalIds.delete(toolCallId);

    // Update the part state to reflect the user's decision.
    const next = [...this.messages];
    const msgIdx = next.findIndex((msg) => (
      Array.isArray(msg.parts) && msg.parts.some((p) => p?.toolCallId === toolCallId)
    ));
    if (msgIdx >= 0) {
      next[msgIdx] = {
        ...next[msgIdx],
        parts: next[msgIdx].parts.map((p) => (
          p?.toolCallId === toolCallId
            ? { ...p, state: approved ? 'input-available' : 'output-denied' }
            : p
        )),
      };
      this.messages = next;
    }

    // Find the approval ID stored on the part (may differ from toolCallId).
    let approvalId = toolCallId;
    this.messages.forEach((msg) => {
      if (!Array.isArray(msg.parts)) return;
      msg.parts.forEach((p) => {
        if (p?.toolCallId === toolCallId && p?.approval?.id) approvalId = p.approval.id;
      });
    });

    // Append the tool-approval-response message the Vercel AI SDK expects.
    this.messages = [...this.messages, {
      role: 'tool',
      content: [{ type: 'tool-approval-response', approvalId, approved }],
      parts: [],
    }];

    if (this._pendingApprovalIds.size > 0) {
      // More approvals still pending — just update the UI.
      this.onUpdate();
      return;
    }

    // All approvals resolved — resume the conversation.
    this.isAwaitingApproval = false;
    this.isThinking = true;
    this.statusText = 'Thinking...';
    this.activeAssistantIndex = null;
    this.onStatusChange(this.statusText);
    this.onUpdate();

    await this._resumeWithMessages();
  }

  async _resumeWithMessages() {
    // Snapshot messages before adding the placeholder so the agent never
    // receives a conversation that ends with the '...' placeholder.
    let agentMessages = this.toAgentMessages();
    agentMessages = this.injectOnPageContext(agentMessages);

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

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      await this._readStream(response.body.getReader());

      if (!this.isAwaitingApproval) {
        saveMessages(this.room, this.messages);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      this.isThinking = false;
      this.isAwaitingApproval = false;
      this._pendingApprovalIds.clear();
      const isNetworkError = e instanceof TypeError;
      if (isNetworkError) {
        this.connected = false;
        this.onConnectionChange(false);
      }
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
    this.isAwaitingApproval = false;
    this._pendingApprovalIds.clear();
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
    this.isAwaitingApproval = false;
    this._pendingApprovalIds.clear();
    this.statusText = '';
    this.processedUpdateToolCalls.clear();
    this.onStatusChange(this.statusText);
    this.onUpdate();
  }

  async loadInitialMessages() {
    try {
      const cached = await loadMessages(this.room);
      if (cached.length > 0) this.syncMessagesFromAgent(cached);
    } catch {
      // IDB unavailable — start with empty history.
    }
  }
}

export default ChatController;
