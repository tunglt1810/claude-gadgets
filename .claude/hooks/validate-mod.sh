#!/bin/sh
# PostToolUse hook: after an Edit/Write under mods/<name>/, validate that mod.
# Reads the hook JSON from stdin; silent for files outside mods/.
file=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))')
case "$file" in
  */mods/*)
    mod=${file#*/mods/}
    mod=${mod%%/*}
    root=${file%%/mods/*}
    claude plugin validate "$root/mods/$mod" 2>&1 | tail -15
    ;;
esac
exit 0
