import { AppLayout } from "@/components/layout/AppLayout";
import { ConversationListPanel } from "@/components/panels/ConversationListPanel";
import { InspectorPanel } from "@/components/panels/InspectorPanel";
import { MainThread } from "@/components/threads/MainThread";

function AgentOSAppShell() {
  return (
    <AppLayout
      leftPanel={<ConversationListPanel />}
      rightPanel={<InspectorPanel />}
    >
      <MainThread />
    </AppLayout>
  );
}

export default AgentOSAppShell;
