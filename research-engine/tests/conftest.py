"""pytest 共享配置：把 research-engine 根目录加入 sys.path，
使 tests/ 下可直接 import engine / qa / conflict / server 模块。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
