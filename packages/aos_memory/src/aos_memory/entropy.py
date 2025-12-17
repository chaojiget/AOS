import logging
from typing import List
from aos_storage.models import LogEntry

# Optional Import for tiktoken
try:
    import tiktoken
except ImportError:
    tiktoken = None

class EntropyService:
    def __init__(self, model_name: str = "gpt-4-turbo"):
        self.encoder = None
        if tiktoken:
            try:
                self.encoder = tiktoken.encoding_for_model(model_name)
            except Exception as e:
                logging.getLogger("aos.memory").warning(f"Could not load tiktoken model: {e}")
        
        # Constants for "Death" thresholds
        self.MAX_TOKENS = 128000 
        self.CRITICAL_ANXIETY = 0.8 

    def count_tokens(self, text: str) -> int:
        """Calculates the entropy (token count) of a given text."""
        if self.encoder:
            return len(self.encoder.encode(text))
        else:
            # Fallback: Rough estimation (1 token ~= 4 chars)
            # This is less accurate but removes the hard dependency
            return len(text) // 4

    def calculate_anxiety(self, logs: List[LogEntry], window_size: int = 10) -> float:
        """
        Calculates 'Anxiety' based on recent failures.
        Anxiety = (Error Count + Warning Count * 0.5) / Window Size
        Range: 0.0 to 1.0 (clamped)
        """
        if not logs:
            return 0.0
            
        recent_logs = logs[:window_size] # Assuming sorted desc
        score = 0
        for log in recent_logs:
            if log.level == "ERROR":
                score += 1.0
            elif log.level == "WARNING":
                score += 0.5
        
        anxiety = score / len(recent_logs)
        return min(anxiety, 1.0)

    def should_reset(self, current_tokens: int, recent_logs: List[LogEntry]) -> bool:
        """
        Decides if Sisyphus needs to die (reset).
        """
        # 1. Token Overflow
        if current_tokens > (self.MAX_TOKENS * 0.9):
            return True
            
        # 2. Panic Attack (Too many errors)
        anxiety = self.calculate_anxiety(recent_logs)
        if anxiety >= self.CRITICAL_ANXIETY:
            return True
            
        return False
