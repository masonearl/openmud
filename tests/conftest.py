"""Configure pytest path for openmud tools."""
import sys
import os

# Add project root to path so `from tools import ...` works in tests
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
