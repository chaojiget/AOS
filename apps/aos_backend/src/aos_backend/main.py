from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging

# AOS Imports
from aos_storage.db import engine, init_db
from aos_storage.models import LogEntry, WisdomItem
from aos_memory.entropy import EntropyService
from aos_memory.odysseus import OdysseusService
from sqlmodel import Session, select

# Initialize
app = FastAPI(title="AOS Backend", version="0.2.0")
entropy_service = EntropyService()
odysseus_service = OdysseusService()

# --- Models ---
class TelemetryEvent(BaseModel):
    level: str
    logger_name: str
    message: str
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    timestamp: Optional[datetime] = None
    attributes: Optional[Dict[str, Any]] = None

class EntropyRequest(BaseModel):
    text: str
    trace_id: Optional[str] = None

# --- Startup ---
@app.on_event("startup")
def on_startup():
    init_db()
    
# --- Routes ---

@app.get("/")
def read_root():
    return {"system": "AOS v0.2", "status": "online"}

@app.post("/api/v1/telemetry/logs")
def ingest_logs(events: List[TelemetryEvent]):
    """
    Ingest logs from external sources (e.g. OpenCode Plugin)
    """
    count = 0
    with Session(engine) as session:
        for event in events:
            # Create LogEntry
            log = LogEntry(
                level=event.level.upper(),
                logger_name=event.logger_name,
                message=event.message,
                trace_id=event.trace_id,
                span_id=event.span_id,
                timestamp=event.timestamp or datetime.utcnow(),
                attributes=json.dumps(event.attributes) if event.attributes else None
            )
            session.add(log)
            count += 1
        session.commit()
    
    return {"status": "success", "ingested": count}

@app.post("/api/v1/entropy/analyze")
def analyze_entropy(request: EntropyRequest):
    """
    Analyze text entropy and return Sisyphus status.
    """
    tokens = entropy_service.count_tokens(request.text)
    
    # Check simple reset condition based on tokens only for now
    # (Full anxiety check requires querying history)
    should_reset = False
    if tokens > entropy_service.MAX_TOKENS * 0.9:
        should_reset = True
        
    return {
        "tokens": tokens,
        "max_tokens": entropy_service.MAX_TOKENS,
        "pressure": tokens / entropy_service.MAX_TOKENS,
        "should_reset": should_reset
    }


from aos_backend.agent import SisyphusAgent

# ... existing code ...

agent = SisyphusAgent()

class TaskRequest(BaseModel):
    instruction: str

class ConsolidateRequest(BaseModel):
    trace_id: str

@app.get("/api/v1/memory/recall")
def recall_memory(limit: int = 3):
    """
    Returns the most recent wisdom items to prime the agent's context.
    """
    items = odysseus_service.get_all_wisdom()
    # Simple limit for now
    return items[:limit] if items else []

@app.post("/api/v1/memory/consolidate")
def consolidate_memory(request: ConsolidateRequest):
    """
    Manually trigger distillation for a given trace.
    Outcome: A news WisdomItem in the Vault.
    """
    wisdom = odysseus_service.distill_trace(request.trace_id)
    if not wisdom:
        raise HTTPException(status_code=404, detail="Trace not found or empty")
    
    return wisdom

@app.post("/api/v1/agent/task")
def run_agent_task(request: TaskRequest):
    """
    Trigger the Sisyphus Agent to perform a task.
    """
    result = agent.run_task(request.instruction)
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
