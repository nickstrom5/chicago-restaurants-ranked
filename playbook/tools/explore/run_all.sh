#!/bin/bash
# Reruns every check of the web app (docs/explore/): the logic test against the iPhone app's own Swift code, headless
# Chrome at 1440 px and as a 390 px phone, and the site's verify.py with docs/ served at the root. See README.md.
#
# usage: playbook/tools/explore/run_all.sh [--mutants] [--no-browser]
#   EXPLORE_WORK  where the mirror, oracle, Chrome profile and screenshots go (default: $TMPDIR/chiranked-explore-tests)
#   CHI_EATS      the chi-eats repo (default: next to this repo)
#   CHROME        Chrome's binary (default: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE="$(cd "$HERE/../../.." && pwd)"
CHI="${CHI_EATS:-$SITE/../chi-eats}"
CHI="$(cd "$CHI" && pwd)" || { echo "no chi-eats repo at $CHI (set CHI_EATS)"; exit 2; }
SRC="$CHI/ios/ChiRanked"
TESTS="$CHI/ios/ChiRankedTests/DataAndSearchTests.swift"
WORK="${EXPLORE_WORK:-${TMPDIR:-/tmp}/chiranked-explore-tests}"
mkdir -p "$WORK"
MUTANTS=0; BROWSER=1
for a in "$@"; do
  case "$a" in --mutants) MUTANTS=1 ;; --no-browser) BROWSER=0 ;; *) echo "unknown option: $a"; exit 2 ;; esac
done
declare -a RESULTS
record() { RESULTS+=("$(printf '%-34s %s' "$1" "$2")"); }
step() { echo; echo "=== $*"; }

step "1/5 mirror: docs/ plus the app's bundled data under a content-addressed data/v1 manifest"
python3 "$HERE/make_mirror.py" "$WORK/mirror" "$SRC/Resources" "$SITE/docs" || { echo "mirror failed"; exit 1; }

step "2/5 oracle: the app's Swift model and search code, built for macOS"
SOURCES=("$SRC/Models/Place.swift" "$SRC/Models/Board.swift" "$SRC/Services/Search.swift" "$SRC/Services/DataStore.swift"
         "$SRC/Services/DataUpdater.swift" "$HERE/oracle/shim.swift" "$HERE/oracle/main.swift")
STAMP=$(cat "${SOURCES[@]}" | shasum -a 256 | cut -c1-16)
BIN="$WORK/oracle-$STAMP"
if [ ! -x "$BIN" ]; then
  echo "building $BIN (about a minute)"
  swiftc -O -swift-version 5 -target "$(uname -m)-apple-macosx15.0" -module-name ChiRankedOracle "${SOURCES[@]}" -o "$BIN" \
    || { echo "the oracle didn't build: a Swift change may need a new line in oracle/shim.swift"; exit 1; }
fi
"$BIN" --out "$WORK/oracle.json" --tools "$HERE" --resources "$SRC/Resources" --tests "$TESTS" || { echo "the oracle failed"; exit 1; }

step "3/5 logic: logic.js against the oracle"
if node "$HERE/check_logic.mjs" --oracle "$WORK/oracle.json" --mirror "$WORK/mirror" --swift "$SRC" > "$WORK/logic.txt" 2>&1; then
  record "logic (vs the app's Swift)" "pass"
else
  record "logic (vs the app's Swift)" "FAIL (see $WORK/logic.txt)"
fi
grep -E "DIFF|^  [a-z]+/|LOGIC:" "$WORK/logic.txt" | head -60

if [ "$BROWSER" = 1 ]; then
  step "4/5 browser: headless Chrome at 1440 and 390 (phone)"
  if node "$HERE/check_browser.mjs" --oracle "$WORK/oracle.json" --mirror "$WORK/mirror" --profile "$WORK/chrome" --shots "$WORK/shots" \
      ${CHROME:+--chrome "$CHROME"} > "$WORK/browser.txt" 2>&1; then
    record "browser (1440 and 390)" "pass"
  else
    record "browser (1440 and 390)" "FAIL (see $WORK/browser.txt)"
  fi
  cat "$WORK/browser.txt" | tail -40
else
  record "browser (1440 and 390)" "skipped"
fi

step "5/5 verify.py with docs/ served at the root"
PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SITE/docs" > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2> /dev/null' EXIT
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.1; done
if SITE_ROOT="http://127.0.0.1:$PORT/" python3 "$SITE/playbook/tools/verify.py" > "$WORK/verify.txt" 2>&1; then
  record "verify.py (explore/ included)" "pass"
else
  record "verify.py (explore/ included)" "FAIL (see $WORK/verify.txt)"
fi
grep -E "FAIL|explore/|PROBLEMS" "$WORK/verify.txt"
kill $SERVER 2> /dev/null; wait $SERVER 2> /dev/null

if [ "$MUTANTS" = 1 ]; then
  step "extra: mutants (bugs planted in a copy of the web app must all be caught; about 5 minutes)"
  if node "$HERE/mutate.mjs" --oracle "$WORK/oracle.json" --mirror "$WORK/mirror" --work "$WORK"; then
    record "mutants" "pass"
  else
    record "mutants" "FAIL"
  fi
fi

echo; echo "=== summary (output in $WORK)"
printf '  %s\n' "${RESULTS[@]}"
printf '%s\n' "${RESULTS[@]}" | grep -q FAIL && exit 1
exit 0
