import subprocess
import logging
import uuid
import json
from typing import List, Dict, Any
from datetime import datetime

# AOS
from aos_telemetry.config import setup_telemetry
from aos_memory.entropy import EntropyService
from aos_memory.odysseus import OdysseusService
from aos_storage.models import LogEntry

class SisyphusAgent:
    def __init__(self, agent_id: str = "sisyphus-01"):
        self.agent_id = agent_id
        # Setup specific logger that writes to DB
        self.tracer = setup_telemetry(f"agent.{agent_id}")
        self.logger = logging.getLogger(f"aos.agent.{agent_id}")
        
        self.entropy = EntropyService()
        self.odysseus = OdysseusService()
        
        # Short-term Memory
        self.memory: List[Dict[str, str]] = [] 
        self.current_trace_id = None

    def run_task(self, instruction: str):
        """
        Executes a task loop.
        """
        # Start a new trace (Life Cycle)
        with self.tracer.start_as_current_span("task_execution") as span:
            # Generate trace ID manually if needed, or use existing span
            if span.get_span_context().is_valid:
                 self.current_trace_id = format(span.get_span_context().trace_id, "032x")
            else:
                 self.current_trace_id = uuid.uuid4().hex

            self.logger.info(f"Thinking: Received task '{instruction}'")
            self.memory.append({"role": "user", "content": instruction})
            
            # 1. Execute Action (Mocking LLM decision to use tool)
            output = ""
            if "git" in instruction.lower():
                self.logger.info("Action: Decided to check git history.")
                output = self._run_bash("git log --oneline -n 30")
                self.memory.append({"role": "tool", "content": output})
                self.logger.info(f"Observation: Retrieved git log ({len(output)} chars).")
            elif "ls" in instruction.lower() or "list" in instruction.lower():
                self.logger.info("Action: Listing directory.")
                output = self._run_bash("ls -R")
                self.memory.append({"role": "tool", "content": output})
            else:
                self.logger.warning("Action: Unsure what to do. Just checking status.")
                output = "No specific action taken."

            # 2. Check Entropy (The Core Constraint)
            # Combine all memory into text
            context_text = json.dumps(self.memory)
            token_count = self.entropy.count_tokens(context_text)
            
            self.logger.info(f"Introspection: Current Context Entropy = {token_count} tokens")
            
            # 3. Simulate Logic/Conclusion
            summary = f"I have analyzed the data. Output length: {len(output)}."
            self.logger.info(f"Thinking: {summary}")
            
            # 4. RESET CHECK (The Sisyphus Moment)
            # Lower threshold for demo purposes
            DEMO_THRESHOLD = 500  
            action_report = "Stable"
            
            if token_count > DEMO_THRESHOLD:
                self.logger.warning(f"CRITICAL: Entropy ({token_count}) exceeded safety limit ({DEMO_THRESHOLD}). Initiating RESET.")
                self._die_and_rebirth()
                action_report = "RESET"
            else:
                self.logger.info("State: Stable. Continuing execution.")

            return {
                "status": "completed", 
                "summary": summary, 
                "trace_id": self.current_trace_id,
                "entropy": token_count,
                "agent_state": action_report
            }

    def _run_bash(self, command: str) -> str:
        try:
            # Run in the project root
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, cwd="/Users/lijianyong/ob/AOS"
            )
            if result.returncode == 0:
                return result.stdout
            else:
                self.logger.error(f"Command failed: {result.stderr}")
                return result.stderr
        except Exception as e:
            self.logger.error(f"Execution error: {e}")
            return str(e)

    def _die_and_rebirth(self):
        """
        The Sisyphus Reset.
        1. Distill wisdom (Odysseus).
        2. Clear memory.
        """
        self.logger.warning("Event: SISYPHUS PROTOCOL ACTIVATED - RESETTING MEMORY")
        
        # 1. Distill
        wisdom = self.odysseus.distill_trace(self.current_trace_id)
        if wisdom:
            self.logger.info(f"Odysseus: Persisted wisdom '{wisdom.title}' to Vault.")
            
        # 2. Wipe
        self.memory = []
        self.logger.info("Event: Rebirth complete. Ready for next cycle.")
