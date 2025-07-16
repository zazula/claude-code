# Claude Development Guidelines

## CRITICAL: Always Test Your Code

**A task is NOT complete until you have actually run and tested the code.**

### Why This Matters
- Assumptions about how code works are often wrong
- Real-world environments have aliases, shell functions, and configurations that affect behavior
- Small syntax errors or logic bugs can break everything
- Users expect working solutions, not theoretical ones

### Testing Checklist
1. ✅ Run the exact command the user will run
2. ✅ Test with the same environment (check for aliases, shell functions)
3. ✅ Test edge cases and error conditions
4. ✅ Verify the output matches expectations
5. ✅ If you can't test directly, create a simulation that closely matches the scenario

### Example from This Session
In this session, I made multiple attempts to fix `claude -c` without actually running it:
- First attempt: Added `-i` flag (which doesn't exist)
- Second attempt: Removed the flag but didn't handle argument passing correctly
- Third attempt: Still had issues with permission-mode arguments

Only when pushed to actually test the code did I discover:
- The user has a `claude` alias that adds permission flags
- The shell function passes arguments in a specific way
- The arguments needed special handling to avoid duplication

### Best Practices
1. **Always run the code** before saying it's fixed
2. **Use debugging output** to understand what's actually happening
3. **Test incrementally** - verify each fix works before moving on
4. **Simulate user environment** when you can't test directly
5. **Don't assume** - verify!

## Remember
"It should work" is not the same as "It works" 🚀