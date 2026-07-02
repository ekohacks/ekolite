# Count the C's in a sequence file. Case-insensitive: both c and C count.
# Takes the file path as its one argument and prints the count as a bare integer,
# which is what runCountC parses with Number(stdout.trim()).
import sys

with open(sys.argv[1]) as handle:
    sequence = handle.read()

print(sequence.lower().count("c"))
