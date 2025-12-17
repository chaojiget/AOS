import { Suspense } from "react";

import { TraceChainView } from "@/components/telemetry/trace-chain-view";

export default function TraceChainPage() {
  return (
    <Suspense fallback={null}>
      <TraceChainView />
    </Suspense>
  );
}
