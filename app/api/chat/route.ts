import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Generate a trace ID for OpenTelemetry
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Simple echo response for now - this will be replaced with LangGraph agent
    const response = `You said: "${message}". This is a placeholder response that will be replaced with the LangGraph agent.`;

    return NextResponse.json({
      message: response,
      traceId,
      timestamp: new Date().toISOString(),
      status: "success"
    });

  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}