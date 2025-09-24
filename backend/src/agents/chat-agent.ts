import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation, START } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { ensureCheckpointSchemaAnnotationsSafe } from '../db/schema-annotations';


export class ChatAgent {
  private agent: any;
  private tracer = trace.getTracer('chat-agent');
  private readonly model: ChatOpenAI;
  private initPromise: Promise<void>;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
      },
    });

    this.initPromise = this.setupAgent();
  }

  async processMessage(message: string, traceId?: string, conversationId?: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<{
    response: string;
    traceId: string;
    duration: number;
  }> {
    await this.initPromise;
    const startTime = Date.now();
    const spanTraceId = traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return await this.tracer.startActiveSpan('agent-process-message', async (span) => {
      try {
        span.setAttributes({
          'agent.message.input': message,
          'agent.trace_id': spanTraceId,
          'agent.model': process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        });

        const response = await this.invokeWithFallback(message, conversationId, conversationHistory);
        const duration = Date.now() - startTime;

        span.setAttributes({
          'agent.message.output': response,
          'agent.duration_ms': duration,
          'agent.success': true,
        });

        span.setStatus({ code: SpanStatusCode.OK });

        return {
          response,
          traceId: spanTraceId,
          duration,
        };

      } catch (error) {
        const duration = Date.now() - startTime;

        span.setAttributes({
          'agent.error': error instanceof Error ? error.message : 'Unknown error',
          'agent.duration_ms': duration,
          'agent.success': false,
        });

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });

        console.error('Agent processing error:', error);

        return {
          response: 'I apologize, but I encountered an error while processing your message. Please try again.',
          traceId: spanTraceId,
          duration,
        };
      } finally {
        span.end();
      }
    });
  }

  private async setupAgent() {
    const dbPath = process.env.LANGGRAPH_CHECKPOINT_PATH || process.env.CHECKPOINT_DB_PATH || './chat_checkpoints.sqlite';
    const checkpointer = SqliteSaver.fromConnString(dbPath);
    checkpointer.setup();
    ensureCheckpointSchemaAnnotationsSafe(dbPath);

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const sys = process.env.AGENT_SYSTEM_PROMPT || '你是对话助手。请根据历史对话记住并使用用户提供的个人信息与上下文。';
      const needSys = state.messages.length === 1;
      const inputMessages = needSys ? [new SystemMessage(sys), ...state.messages] : state.messages;
      const response = await this.model.invoke(inputMessages);
      return { messages: [response] };
    };

    const builder = new StateGraph(MessagesAnnotation);
    builder.addNode('call_model', callModel);
    builder.addEdge(START, 'call_model');
    this.agent = builder.compile({ checkpointer });
  }

  private async invokeWithFallback(message: string, conversationId?: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<string> {
    try {
      return await this.invokeAgent(message, conversationId, conversationHistory);
    } catch (error) {
      throw error;
    }
  }

  private async invokeAgent(message: string, conversationId?: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<string> {
    if (this.agent) {
      const result = await this.agent.invoke(
        { messages: [new HumanMessage(message)] },
        { configurable: { thread_id: conversationId || 'default' } }
      );
      const agentResponse = result.messages[result.messages.length - 1];
      return this.extractContent(agentResponse?.content ?? '');
    }

    const history = conversationHistory ? await this.getConversationHistory(conversationHistory) : [];
    const directResponse = await this.model.invoke([...history, new HumanMessage(message)]);
    return this.extractContent(directResponse.content);
  }

  private extractContent(content: AIMessage['content']): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part === 'string') {
            return part;
          }
          if (part.type === 'text' && 'text' in part) {
            return part.text ?? '';
          }
          return '';
        })
        .join('')
        .trim();
    }

    return '';
  }


  async getConversationHistory(messages: Array<{ role: string; content: string }>): Promise<any[]> {
    return messages.map(msg => {
      return msg.role === 'user'
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content);
    });
  }

  async *streamText(message: string, conversationId?: string, conversationHistory?: Array<{ role: string; content: string }>): AsyncGenerator<string> {
    await this.initPromise;
    if (this.agent) {
      const stream = await this.agent.stream(
        { messages: [new HumanMessage(message)] },
        { streamMode: 'values', configurable: { thread_id: conversationId || 'default' } }
      );
      let sent = '';
      for await (const { messages } of stream as any) {
        const last = messages[messages.length - 1];
        if (!(last instanceof AIMessage)) continue;
        const full = this.extractContent(last?.content ?? '');
        if (!full) continue;
        const delta = full.slice(sent.length);
        if (delta) {
          sent = full;
          yield delta;
        }
      }
      return;
    }
    const history = conversationHistory ? await this.getConversationHistory(conversationHistory) : [];
    const directResponse = await this.model.invoke([...history, new HumanMessage(message)]);
    yield this.extractContent(directResponse.content);
  }
}
