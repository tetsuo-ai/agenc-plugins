#!/usr/bin/env bash
# zdh-slice.sh - extract a budget-capped call-graph slice around an entry symbol.
#
# Heuristic for brace-bodied languages (C/C++/Go/JS/Java): BFS from the entry
# symbol, expanding callee identifiers found inside each definition body plus
# callers found by grep. Not a parser - verify gaps with ctags/joern/codeql on
# big targets (see references/toolchain.md). For Python, bodies fall back to
# whole defining files.
#
# Usage: zdh-slice.sh <repo> <symbol> [depth=3] [max-lines=10000]
set -eu

REPO="${1:?usage: zdh-slice.sh <repo> <symbol> [depth=3] [max-lines=10000]}"
SYMBOL="${2:?entry symbol required}"
DEPTH="${3:-3}"
MAXLINES="${4:-10000}"

SRC_EXT=(c h cc cpp cxx hpp go js ts jsx tsx java rs py)
inc=(); for e in "${SRC_EXT[@]}"; do inc+=(--include="*.$e"); done

# files defining a symbol: definition-like line at column 0 (not an indented call)
def_files() {  # $1 = symbol
  [ -z "$1" ] && return 0
  grep -rlE "^[A-Za-z_][A-Za-z0-9_[:space:]\*]*$1[[:space:]]*\(" "$REPO" "${inc[@]}" 2>/dev/null || true
}
# callee identifiers inside the definition body of $2 in file $1
body_callees() {
  awk -v sym="$2" '
    $0 ~ ("^[A-Za-z_][A-Za-z0-9_ \t*]*" sym "[ \t]*\\(") { inbody=1; depth=0 }
    inbody {
      line=$0
      while (match(line, /[A-Za-z_][A-Za-z0-9_]*[ \t]*\(/)) {
        tok=substr(line, RSTART, RLENGTH); gsub(/[ \t(]/, "", tok); print tok
        line=substr(line, RSTART+RLENGTH)
      }
      opens=gsub(/{/, "{"); closes=gsub(/}/, "}")
      depth+=opens-closes
      if (inbody && depth<=0 && $0 ~ /}/) inbody=0
    }' "$1" | sort -u
}

is_keyword() {
  case "$1" in
    if|for|while|switch|return|sizeof|catch|else|do|case|new|delete|throw|typeof|await|async|func|fn|let|const|var|def|class|struct|enum|match|impl|pub|use|import|from|print|echo) return 0 ;;
    *) return 1 ;;
  esac
}

# Newline-delimited sets instead of associative arrays, so the stock macOS
# bash 3.2 runs this script too. The quoted "$1" matches literally.
SEEN_FILES=$'\n'; VISITED_SYMS=$'\n'
seen_file() { case "$SEEN_FILES" in *$'\n'"$1"$'\n'*) return 0 ;; esac; return 1; }
mark_file() { SEEN_FILES="$SEEN_FILES$1"$'\n'; }
visited_sym() { case "$VISITED_SYMS" in *$'\n'"$1"$'\n'*) return 0 ;; esac; return 1; }
mark_sym() { VISITED_SYMS="$VISITED_SYMS$1"$'\n'; }

queue=("$SYMBOL"); level=0
ORDERED_FILES=()

while [ "${#queue[@]}" -gt 0 ] && [ "$level" -le "$DEPTH" ]; do
  next=()
  for sym in "${queue[@]}"; do
    [ -z "$sym" ] && continue
    visited_sym "$sym" && continue
    mark_sym "$sym"
    # Read paths line by line so a file name with spaces stays one path.
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if ! seen_file "$f"; then
        mark_file "$f"; ORDERED_FILES+=("$f")
        if [ "$level" -lt "$DEPTH" ]; then
          while IFS= read -r c; do
            [ -z "$c" ] && continue
            is_keyword "$c" && continue
            [ "$c" = "$sym" ] && continue
            visited_sym "$c" || next+=("$c")
          done < <(body_callees "$f" "$sym")
        fi
      fi
    done < <(def_files "$sym")
    # callers: files referencing the symbol
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if ! seen_file "$f"; then
        mark_file "$f"; ORDERED_FILES+=("$f")
      fi
    done < <(grep -rlE "\b$sym[[:space:]]*\(" "$REPO" "${inc[@]}" 2>/dev/null || true)
  done
  if [ "${#next[@]}" -gt 0 ]; then queue=("${next[@]}"); else queue=(); fi
  level=$((level+1))
done

total=0; truncated=0
for f in ${ORDERED_FILES[@]+"${ORDERED_FILES[@]}"}; do
  [ -z "$f" ] && continue
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ $((total + lines)) -gt "$MAXLINES" ]; then truncated=1; break; fi
  printf '===== %s (%s lines) =====\n' "${f#"$REPO"/}" "$lines"
  cat "$f"
  total=$((total + lines))
done

echo "----- zdh-slice: ${#ORDERED_FILES[@]} files considered, $total lines emitted, depth=$DEPTH" >&2
[ "$truncated" = "1" ] && echo "WARNING: slice exceeded $MAXLINES lines and was truncated - narrow to a deeper entry point." >&2
exit 0
