"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Send, Bot, User, Activity, Database, FileText } from "lucide-react";
import { getApiBaseUrl, getChatStreamEndpoint } from "@/lib/apiConfig";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  traceId?: string;
}

interface ChatStats {
  totalMessages: number;
  responseTime: number;
  activeTraces: number;
}

type SessionMeta = { id: string; title: string };

export default function ChatPage() {
  const [isClient, setIsClient] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>("default");
  const [sessions, setSessionsState] = useState<SessionMeta[]>([]);

  useEffect(() => {
    setIsClient(true);
    const cid = getConversationId();
    setConversationId(cid);
    const stored = loadMessages(cid);
    if (stored && stored.length) {
      setMessages(stored);
    } else {
      const welcome = {
        id: "1",
        content: "你好！我是你的AI助手。有什么可以帮助你的吗？",
        role: "assistant",
        timestamp: new Date(),
        traceId: "trace-001"
      } as Message;
      setMessages([welcome]);
      saveMessages(cid, [welcome]);
    }
  }, []);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<ChatStats>({
    totalMessages: 1,
    responseTime: 0,
    activeTraces: 1
  });

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setSessionsState(readSessionsFromStorage());
  }, []);

  const getConversationId = () => {
    if (typeof window === "undefined") return "default";
    const key = "conversationId";
    let id = localStorage.getItem(key);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  };

  const saveMessages = (cid: string, list: Message[]) => {
    if (typeof window === "undefined") return;
    const compact = list.map(m => ({ id: m.id, content: m.content, role: m.role, timestamp: m.timestamp.toISOString(), traceId: m.traceId }));
    localStorage.setItem(`messages:${cid}`, JSON.stringify(compact));
  };

  const loadMessages = (cid: string): Message[] | null => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(`messages:${cid}`);
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw) as any[];
      return arr.map(x => ({ id: x.id, content: x.content, role: x.role, timestamp: new Date(x.timestamp), traceId: x.traceId }));
    } catch {
      return null;
    }
  };

  const readSessionsFromStorage = (): SessionMeta[] => {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem("sessions");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SessionMeta[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const persistSessions = (update: SessionMeta[] | ((prev: SessionMeta[]) => SessionMeta[])) => {
    setSessionsState(prev => {
      const next = typeof update === "function" ? (update as (prev: SessionMeta[]) => SessionMeta[])(prev) : update;
      if (typeof window !== "undefined") {
        localStorage.setItem("sessions", JSON.stringify(next));
      }
      return next;
    });
  };

  const switchConversation = (cid: string) => {
    if (typeof window !== "undefined") localStorage.setItem("conversationId", cid);
    setConversationId(cid);
    persistSessions(prev => (prev.some(session => session.id === cid) ? prev : [...prev, { id: cid, title: "" }]));
    const loaded = loadMessages(cid);
    if (loaded && loaded.length) {
      setMessages(loaded);
    } else {
      const fallback = [
        { id: "1", content: "你好！我是你的AI助手。有什么可以帮助你的吗？", role: "assistant", timestamp: new Date(), traceId: "trace-001" }
      ];
      setMessages(fallback);
      saveMessages(cid, fallback);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const cid = getConversationId();
    setConversationId(cid);

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input,
      role: "user",
      timestamp: new Date()
    };

    setMessages(prev => {
      const next = [...prev, userMessage];
      saveMessages(cid, next);
      return next;
    });
    setInput("");
    setIsLoading(true);

    const startTime = Date.now();

    try {
      // 流式调用后端
      const response = await fetch(getChatStreamEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: input, conversationId: cid })
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const assistantId = (Date.now() + 1).toString();
      setMessages(prev => {
        const next = [
          ...prev,
          { id: assistantId, content: "", role: "assistant", timestamp: new Date() }
        ];
        saveMessages(cid, next);
        return next;
      });

      let traceId: string | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split(/\n\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          try {
            const evt = JSON.parse(dataStr);
            if (evt.chunk) {
              setMessages(prev => {
                const next = prev.map(m => m.id === assistantId ? { ...m, content: (m.content || "") + evt.chunk, traceId: evt.traceId || m.traceId } : m);
                saveMessages(cid, next);
                return next;
              });
              traceId = evt.traceId || traceId;
            }
            if (evt.done) {
              const responseTime = Date.now() - startTime;
              setStats(prev => ({
                totalMessages: prev.totalMessages + 2,
                responseTime,
                activeTraces: prev.activeTraces + 1
              }));
            }
            if (evt.error) throw new Error(evt.error);
          } catch {}
        }
      }

    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `抱歉，连接服务器时遇到问题。请确保后端服务在 ${getApiBaseUrl()} 上运行并提供 /api/chat 接口。错误信息: ${error instanceof Error ? error.message : '未知错误'}`,
        role: "assistant",
        timestamp: new Date()
      };
      setMessages(prev => {
        const next = [...prev, errorMessage];
        saveMessages(cid, next);
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Sidebar - Monitoring Stats */}
      <div className="w-80 border-r bg-muted/50 p-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              系统监控
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">总消息数</span>
              <Badge variant="secondary">{stats.totalMessages}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">平均响应时间</span>
              <Badge variant="outline">{stats.responseTime}ms</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">活跃追踪</span>
              <Badge variant="default">{stats.activeTraces}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              遥测系统
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                <span className="text-sm">数据库已连接</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                <span className="text-sm">追踪收集中</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-orange-500 rounded-full"></div>
                <span className="text-sm">指标活跃</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              最近追踪
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <div className="space-y-2">
                {messages
                  .filter(m => m.traceId)
                  .slice(-5)
                  .map((message) => (
                    <div key={message.id} className="text-xs p-2 bg-muted rounded">
                      <div className="font-mono text-blue-600">{message.traceId}</div>
                      <div className="text-muted-foreground flex justify-between">
                        <span>{message.timestamp.toLocaleTimeString()}</span>
                        <span className="font-mono">{conversationId}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground truncate">
                        {(messages.find(msg => msg.role === 'user')?.content || '')
                          .split(/\s+/)
                          .slice(0, 5)
                          .join(' ')}
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              会话摘要
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">会话ID</span>
                <span className="font-mono">{conversationId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">首句</span>
                <div className="mt-1 font-mono truncate">
                  {(messages.find(msg => msg.role === 'user')?.content || '')
                    .split(/\s+/)
                    .slice(0, 5)
                    .join(' ')}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              历史会话
            </CardTitle>
            <Button size="sm" variant="secondary" onClick={() => {
              const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
              localStorage.setItem("conversationId", id);
              setConversationId(id);
              const welcome = { id: "1", content: "你好！我是你的AI助手。有什么可以帮助你的吗？", role: "assistant", timestamp: new Date(), traceId: "trace-001" } as Message;
              setMessages([welcome]);
              saveMessages(id, [welcome]);
              persistSessions(prev => [...prev, { id, title: "" }]);
            }}>新会话</Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <div className="space-y-2">
                {sessions.slice(-50).reverse().map(s => (
                  <div key={s.id} className="p-2 rounded border hover:bg-muted cursor-pointer" onClick={() => switchConversation(s.id)}>
                    <div className="flex justify-between text-xs">
                      <span className="font-mono truncate max-w-[60%]">{s.id}</span>
                      <span className="text-muted-foreground truncate max-w-[40%]">{s.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b p-4">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            AOS AI 助手
          </h1>
          <p className="text-sm text-muted-foreground">
            基于LangGraph构建，支持OpenTelemetry监控
          </p>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}

                <div
                  className={`max-w-[70%] p-3 rounded-lg ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="text-sm">{message.content}</div>
                  <div className="flex items-center gap-2 mt-2 text-xs opacity-70">
                    {isClient && <span>{message.timestamp.toLocaleTimeString()}</span>}
                    {message.traceId && (
                      <>
                        {isClient && <Separator orientation="vertical" className="h-3" />}
                        <span className="font-mono">{message.traceId}</span>
                      </>
                    )}
                  </div>
                </div>

                {message.role === "user" && (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="max-w-[70%] p-3 rounded-lg bg-muted">
                  <div className="flex space-x-1">
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce"></div>
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce" style={{animationDelay: "0.1s"}}></div>
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce" style={{animationDelay: "0.2s"}}></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的消息..."
                className="flex-1"
                disabled={isLoading}
              />
              <Button
                onClick={sendMessage}
                disabled={isLoading || !input.trim()}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              按回车发送，Shift+回车换行
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
