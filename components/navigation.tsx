"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Activity,
  Plug,
  Cpu,
  ListChecks,
  BookOpen,
  Settings,
  Boxes,
} from "lucide-react";

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-2">
              <Bot className="h-6 w-6" />
              <span className="font-bold text-lg">AOS</span>
            </div>

            <div className="flex space-x-4">
              <Link href="/">
                <Button
                  variant={pathname === "/" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <Bot className="h-4 w-4" />
                  <span>聊天</span>
                </Button>
              </Link>

              <Link href="/telemetry">
                <Button
                  variant={pathname === "/telemetry" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <Activity className="h-4 w-4" />
                  <span>监控</span>
                </Button>
              </Link>

              <Link href="/integrations">
                <Button
                  variant={pathname === "/integrations" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <Plug className="h-4 w-4" />
                  <span>集成</span>
                </Button>
              </Link>

              <Link href="/sandbox">
                <Button
                  variant={pathname === "/sandbox" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <Boxes className="h-4 w-4" />
                  <span>沙箱</span>
                </Button>
              </Link>

              <Link href="/agents">
                <Button
                  variant={pathname === "/agents" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <Cpu className="h-4 w-4" />
                  <span>Agents</span>
                </Button>
              </Link>

              <Link href="/projects">
                <Button
                  variant={pathname === "/projects" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <ListChecks className="h-4 w-4" />
                  <span>项目</span>
                </Button>
              </Link>

              <Link href="/memory">
                <Button
                  variant={pathname === "/memory" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>记忆</span>
                </Button>
              </Link>

              <Link href="/settings">
                <Button
                  variant={pathname === "/settings" ? "default" : "ghost"}
                  className="flex items-center space-x-2"
                >
                  <Settings className="h-4 w-4" />
                  <span>设置</span>
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-sm text-muted-foreground">
              AI聊天与监控系统
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
