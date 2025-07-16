#!/usr/bin/env bash

# Setup script for Claude -c workaround

echo "Setting up Claude -c workaround..."

# Remove old claude alias and function from .zshrc
sed -i.bak '/^alias claude=/d' ~/.zshrc
sed -i.bak '/^claude() {/,/^}/d' ~/.zshrc

# Add the new configuration
cat >> ~/.zshrc << 'EOF'

# Claude -c workaround for bug in v1.0.53
claude() {
  local real_claude="/opt/homebrew/bin/claude"
  local permission_flags="--permission-mode bypassPermissions"
  
  if [[ "$1" == "-c" || "$1" == "--continue" ]]; then
    # Use workaround for -c flag
    shift
    claude-continue $permission_flags "$@"
  else
    # Normal claude with permission flags
    $real_claude $permission_flags "$@"
  fi
}
EOF

echo "✅ Setup complete!"
echo ""
echo "Please run: source ~/.zshrc"
echo ""
echo "Then you can use:"
echo "  claude -c     # Continue last session in current directory"
echo "  claude        # Start new session"
echo "  claude -r     # Resume specific session"