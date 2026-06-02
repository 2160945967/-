#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Simple startup script for 拾词
"""

import os
import sys
import webbrowser
from threading import Timer

def main():
    print("=" * 50)
    print("拾词")
    print("=" * 50)
    print()
    
    # Check Python version
    print("[1/4] Checking Python...")
    if sys.version_info < (3, 6):
        print("ERROR: Python 3.6+ is required")
        return 1
    print(f"Python version: {sys.version}")
    print()
    
    # Check dependencies
    print("[2/4] Checking dependencies...")
    try:
        import flask
        print("Flask is installed")
    except ImportError:
        print("Installing Flask...")
        import subprocess
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "flask"])
            print("Flask installed successfully")
        except:
            print("ERROR: Failed to install Flask")
            return 1
    print()
    
    # Check dictionary files
    print("[3/4] Checking dictionary files...")
    if not os.path.exists("ecdict.csv"):
        print("ERROR: ecdict.csv not found")
        return 1
    print("Dictionary files ready")
    print()
    
    # Start server
    print("[4/4] Starting server...")
    print()
    print("=" * 50)
    print("Server is starting...")
    print("DO NOT close this window")
    print("Browser will open automatically")
    print("=" * 50)
    print()
    
    # Import and run Flask app directly (app.py will handle opening browser)
    from app import app
    app.run(debug=False, host="0.0.0.0", port=5000)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
