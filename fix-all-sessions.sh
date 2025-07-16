#!/bin/bash

echo "Fixing all sessions in realie.ai project..."

for file in ~/.claude/projects/-Users-zazula-Developer-re-realie-ai/*.jsonl; do
  if [[ ! "$file" =~ backup|fixed ]]; then
    basename=$(basename "$file")
    echo ""
    echo "Checking $basename..."
    node fix-session.js --auto "$file"
  fi
done

echo ""
echo "All sessions processed!"