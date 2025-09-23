import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { DynamicTool } from '@langchain/core/tools';
import { z } from 'zod';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

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

  constructor() {
    const model = new ChatOpenAI({
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    this.agent = createReactAgent({
      llm: model,
      tools: [searchTool, calculatorTool, timeToolTool],
    });
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
          'agent.model': 'gpt-3.5-turbo',
        });

        // Invoke the agent with the user message
        const result = await this.agent.invoke({
          messages: [new HumanMessage(message)],
        });

        const response = result.messages[result.messages.length - 1].content;
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