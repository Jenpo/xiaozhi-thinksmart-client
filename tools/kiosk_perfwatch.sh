#!/bin/bash
# Kiosk rendering profiler for the "前端卡顿" item (handoff 2026-11-20 §没做完 1).
# Runs on the device (nohup), no restarts, read-only on the kiosk/web processes.
#   every 5 s: per-thread CPU % of kiosk UI main thread, WebKitWebProcess main thread,
#              ThreadedCompositor, and both process totals  -> $OUT/cpu.tsv
#   when the kiosk UI main thread > $HOT % : py-spy record --native 20 s (raw collapsed
#              stacks) -> $OUT/ui-<ts>.txt, at most $MAXCAP captures, >= 10 min apart.
# Stops by itself at $UNTIL (epoch seconds).
# Usage: nohup tools/kiosk_perfwatch.sh <until-epoch> >/dev/null 2>&1 &
UNTIL=${1:?until epoch}
OUT=${OUT:-$HOME/perfwatch}
HOT=${HOT:-40}
MAXCAP=${MAXCAP:-8}
SPY=$HOME/.local/bin/py-spy
HZ=$(getconf CLK_TCK)
mkdir -p "$OUT"
[ -f "$OUT/cpu.tsv" ] || echo -e "time\tui_main\tweb_main\tcompositor\tkiosk_all\tweb_all\tjs_threads" > "$OUT/cpu.tsv"

ticks() { awk '{print $14+$15}' "$1" 2>/dev/null || echo 0; }
proc_ticks() { awk '{print $14+$15}' "/proc/$1/stat" 2>/dev/null || echo 0; }
comp_tid() { grep -l "Compositor" /proc/$1/task/*/comm 2>/dev/null | head -1 | awk -F/ '{print $5}'; }

caps=$(ls "$OUT"/ui-*.txt 2>/dev/null | wc -l); last=0
declare -A prev
while [ "$(date +%s)" -lt "$UNTIL" ]; do
  K=$(pgrep -f '^/usr/bin/python3 /usr/local/bin/thinksmart-kiosk.py' | head -1)
  W=$(pgrep -f 'WebKitWebProcess' | head -1)
  [ -z "$K" ] || [ -z "$W" ] && { sleep 5; continue; }
  C=$(comp_tid "$W")
  declare -A now=(
    [ui]=$(ticks /proc/$K/task/$K/stat) [web]=$(ticks /proc/$W/task/$W/stat)
    [comp]=$(ticks /proc/$W/task/${C:-0}/stat) [kall]=$(proc_ticks $K) [wall]=$(proc_ticks $W)
  )
  key="$K/$W"
  if [ "${prev[key]}" = "$key" ]; then
    pct() { echo $(( (${now[$1]} - ${prev[$1]}) * 100 / (5 * HZ) )); }
    ui=$(pct ui)
    echo -e "$(date +%H:%M:%S)\t$ui\t$(pct web)\t$(pct comp)\t$(pct kall)\t$(pct wall)\t$(ls /proc/$W/task | wc -l)" >> "$OUT/cpu.tsv"
    t=$(date +%s)
    if [ "$ui" -ge "$HOT" ] && [ "$caps" -lt "$MAXCAP" ] && [ $((t - last)) -ge 600 ]; then
      ts=$(date +%m%d-%H%M%S)
      sudo -n "$SPY" record --native -r 50 -d 20 -f raw -o "$OUT/ui-$ts.txt" --pid "$K" \
        > "$OUT/ui-$ts.log" 2>&1
      caps=$((caps + 1)); last=$t
    fi
  fi
  for k in "${!now[@]}"; do prev[$k]=${now[$k]}; done
  prev[key]=$key
  sleep 5
done
