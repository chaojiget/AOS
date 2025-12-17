import logging
import sys
# Path hacks for direct execution
sys.path.append("packages/aos_memory/src")
sys.path.append("packages/aos_storage/src")
sys.path.append("packages/aos_telemetry/src")

from aos_memory.entropy import EntropyService
from aos_storage.models import LogEntry
from datetime import datetime

def main():
    service = EntropyService()
    
    # 1. Test Token Counting
    text = "The quick brown fox jumps over the lazy dog."
    tokens = service.count_tokens(text)
    print(f"Text: '{text}'")
    print(f"Entropy (Tokens): {tokens}")
    
    # 2. Test Anxiety Calculation
    print("\n--- Testing Anxiety ---")
    
    # Scenario A: All good
    logs_good = [LogEntry(level="INFO", message="OK", logger_name="test") for _ in range(10)]
    anxiety_a = service.calculate_anxiety(logs_good)
    print(f"Scenario A (All INFO): Anxiety = {anxiety_a}")
    
    # Scenario B: Panic
    logs_panic = [LogEntry(level="ERROR", message="Fail", logger_name="test") for _ in range(8)]
    logs_panic += [LogEntry(level="INFO", message="OK", logger_name="test") for _ in range(2)]
    anxiety_b = service.calculate_anxiety(logs_panic)
    print(f"Scenario B (80% Errors): Anxiety = {anxiety_b}")
    
    # 3. Reset Decision
    should_die = service.should_reset(current_tokens=500, recent_logs=logs_panic)
    print(f"Should Sisyphus die in Scenario B? {'YES' if should_die else 'NO'}")

if __name__ == "__main__":
    main()
