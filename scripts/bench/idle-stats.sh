#!/usr/bin/env bash
# Usage: idle-stats.sh <container> <seconds> <out.csv>
# Samples docker stats (~1/s) and prints avg/p95/max CPU% and memory (MiB).
set -euo pipefail
c=$1; secs=$2; out=$3
: > "$out"
end=$(( $(date +%s) + secs ))
while [ "$(date +%s)" -lt "$end" ]; do
  docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$c" >> "$out"
done
tomib='function mib(s, n,u){ n=s+0; u=s; gsub(/[0-9. ]/,"",u); if(u=="GiB")return n*1024; if(u=="KiB"||u=="kB")return n/1024; if(u=="B")return n/1048576; return n }'
cpus=$(awk -F, '{v=$1; sub(/%/,"",v); print v+0}' "$out" | sort -n)
n=$(echo "$cpus" | wc -l | tr -d ' ')
p95=$(echo "$cpus" | sed -n "$(( (n*95+99)/100 ))p")
awk -F, "$tomib"'
{ v=$1; sub(/%/,"",v); split($2,m," / "); mem=mib(m[1]); cs+=v; ms+=mem; if(v+0>cm)cm=v+0; if(mem>mx)mx=mem; if(NR==1||mem<mn)mn=mem }
END { printf "samples=%d cpu_avg=%.2f%% cpu_p95='"$p95"'%% cpu_max=%.2f%% mem_avg=%.1fMiB mem_min=%.1fMiB mem_max=%.1fMiB\n", NR, cs/NR, cm, ms/NR, mn, mx }' "$out"
