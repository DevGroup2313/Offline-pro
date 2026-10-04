# PyInstaller runtime hook: a windowed program has no console, so Python
# gives it no standard output. Anything Inkwell prints goes nowhere instead
# of stopping the program.
import os
import sys

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")
