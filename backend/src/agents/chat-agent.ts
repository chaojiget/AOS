import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { DynamicTool } from '@langchain/core/tools';
import { z } from 'zod';
import { trace, SpanStatusCode } from '@opentelemetry/api';

// Define tools for the agent
const searchTool = new DynamicTool({
  name: 'search',
  description: 'Search for information on the web',
  schema: z.object({
    query: z.string().describe('The search query'),
  }),
  func: async ({ query }) => {
    // Simulate search functionality
    await new Promise(resolve => setTimeout(resolve, 500));
    return `Search results for "${query}": This is a simulated search result. In a real implementation, this would connect to a search API.`;
  },
});

const calculatorTool = new DynamicTool({
  name: 'calculator',
  description: 'Perform mathematical calculations',
  schema: z.object({
    expression: z.string().describe('The mathematical expression to evaluate'),
  }),
  func: async ({ expression }) => {
    try {
      // Simple calculator implementation
      const result = eval(expression.replace(/[^0-9+\-*/().\s]/g, ''));
      return `Result: ${result}`;
    } catch (error) {
      return 'Error: Invalid mathematical expression';
    }
  },
});

const timeToolTool = new DynamicTool({
  name: 'get_current_time',
  description: 'Get the current date and time',
  schema: z.object({}),
  func: async () => {
    const now = new Date();
    return `Current date and time: ${now.toISOString()}`;
  },
});

export class ChatAgent {
  private agent: any;
  private tracer = trace.getTracer('chat-agent');
  private readonly model: ChatOpenAI;
  private toolsEnabled = true;

  constructor() {
    this.toolsEnabled = process.env.AGENT_ENABLE_TOOLS !== 'false';

    this.model = new ChatOpenAI({
      modelName: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
      },
    });

    if (this.shouldUseTools()) {
      this.agent = createReactAgent({
        llm: this.model,
        tools: [searchTool, calculatorTool, timeToolTool],
      });
    }
  }

  async processMessage(message: string, traceId?: string): Promise<{
    response: string;
    traceId: string;
    duration: number;
  }> {
    const startTime = Date.now();
    const spanTraceId = traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return await this.tracer.startActiveSpan('agent-process-message', async (span) => {
      try {
        span.setAttributes({
          'agent.message.input': message,
          'agent.trace_id': spanTraceId,
          'agent.model': process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        });

        // Invoke the agent with the user message
        const response = await this.invokeWithFallback(message);
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

  private shouldUseTools(): boolean {
    return this.toolsEnabled;
  }

  private async invokeWithFallback(message: string): Promise<string> {
    try {
      return await this.invokeAgent(message);
    } catch (error) {
      if (this.toolsEnabled && this.isToolUnsupportedError(error)) {
        console.warn('检测到当前模型不支持工具调用，回退为纯对话模式');
        this.disableAgentTools();
        return await this.invokeAgent(message);
      }
      throw error;
    }
  }

  private async invokeAgent(message: string): Promise<string> {
    if (this.toolsEnabled && this.agent) {
      const result = await this.agent.invoke({
        messages: [new HumanMessage(message)],
      });
      const agentResponse = result.messages[result.messages.length - 1];
      return this.extractContent(agentResponse?.content ?? '');
    }

    const directResponse = await this.model.invoke([new HumanMessage(message)]);
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

  private isToolUnsupportedError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const message = error instanceof Error ? error.message : (error as any).error?.message;
      if (typeof message === 'string' && message.includes('No endpoints found that support tool use')) {
        return true;
      }
      if ('status' in error && (error as any).status === 404 && typeof message === 'string') {
        return message.toLowerCase().includes('tool');
      }
    }
    return false;
  }

  private disableAgentTools() {
    this.toolsEnabled = false;
    this.agent = undefined;
  }

  async getConversationHistory(messages: Array<{ role: string; content: string }>): Promise<any[]> {
    return messages.map(msg => {
      return msg.role === 'user'
        ? new HumanMessage(msg.content)
        : new AIMessage(msg.content);
    });
  }

  async processStreamingMessage(message: string, traceId?: string): Promise<string> {
    const spanTraceId = traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return await this.tracer.startActiveSpan('agent-stream-message', async (span) => {
      try {
        span.setAttributes({
          'agent.message.input': message,
          'agent.trace_id': spanTraceId,
          'agent.streaming': true,
        });

        // For now, just use the regular processing method
        const result = await this.processMessage(message, spanTraceId);

        span.setStatus({ code: SpanStatusCode.OK });
        return result.response;

      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
