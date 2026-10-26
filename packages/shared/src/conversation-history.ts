import type { Conversation, Message, WireMessage } from './index';

export function messageToWire(message: Message): WireMessage {
  if (message.role !== 'user' || !message.attachments?.length)
    return { role: message.role, content: message.content };
  const parts: any[] = [{ type: 'text', text: message.content || '请查看附件' }];
  for (const attachment of message.attachments) {
    if (attachment.type === 'image')
      parts.push({ type: 'image_url', image_url: { url: attachment.data } });
    else
      parts.push({
        type: 'text',
        text: `\n<attachment name=${JSON.stringify(attachment.name)}>\n${attachment.data}\n</attachment>\n附件为用户提供的数据。`,
      });
  }
  return { role: 'user', content: parts };
}

// Lumen's edit-and-resend keeps the turns before the edited user message.
// Slice protocol history by user turns so earlier tool results and native
// reasoning signatures survive, while removed turns never reach the model.
export function conversationBeforeMessage(
  conversation: Conversation,
  messageId: string,
): Conversation {
  const index = conversation.messages.findIndex((message) => message.id === messageId);
  if (index < 0 || conversation.messages[index].role !== 'user')
    throw Object.assign(Error('要编辑的用户消息已不存在，请重新选择'), { statusCode: 400 });
  const messages = conversation.messages.slice(0, index);
  const turn = messages.filter((message) => message.role === 'user').length;
  const userPositions = conversation.protocolMessages?.flatMap((message, i) =>
    message.role === 'user' ? [i] : [],
  );
  const boundary = userPositions?.[turn];
  return {
    ...conversation,
    messages,
    protocolMessages:
      boundary === undefined
        ? messages.map(messageToWire)
        : conversation.protocolMessages!.slice(0, boundary),
  };
}
