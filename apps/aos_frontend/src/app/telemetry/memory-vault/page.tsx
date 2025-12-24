import Link from 'next/link';
import { ArrowLeft, Construction } from 'lucide-react';

export default function MemoryVaultPage() {
  return (
    <main className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-aos-muted hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Memory Vault</h1>
        </header>

        <div className="text-center py-16">
          <Construction className="w-16 h-16 mx-auto mb-4 text-aos-muted" />
          <h2 className="text-xl font-semibold mb-2">建设中</h2>
          <p className="text-aos-muted">
            WisdomItem 记忆卡片浏览功能即将上线
          </p>
          <p className="text-aos-muted text-sm mt-4">
            需要先启用 <code className="bg-aos-card px-2 py-0.5 rounded">AOS_MEMORY_LLM=1</code> 开启蒸馏功能
          </p>
        </div>
      </div>
    </main>
  );
}
