#!/bin/bash

echo "Searching for tool IDs in session files..."

for file in ~/.claude/projects/-Users-zazula-Developer-re-realie-ai/*.jsonl; do
  if [[ ! "$file" =~ backup|fixed ]] && [[ "$file" != *"38795a5d"* ]]; then
    basename=$(basename "$file")
    count=$(grep -c "toolu_014F6R5piBxVrJdLbwTHigJW\|toolu_01JMxCAMPpQrn576vDkjCfDn" "$file" 2>/dev/null || echo "0")
    if [ "$count" -gt 0 ]; then
      echo "$basename: $count matches"
    fi
  fi
done