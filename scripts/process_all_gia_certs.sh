#!/bin/bash
# Process all 15 GIA certs sequentially

SCRIPT="$HOME/.openclaw/workspace/scripts/gia_cert_analyzer_refactored_v16.0.0.js"
OUTPUT="$HOME/Desktop/GIA_Analysis_v39_Group5.json"

declare -a CERTS=(
  "6234129129"
  "6234158920"
  "6234175633"
  "6234289441"
  "6237208621"
  "6237543868"
  "6237791422"
  "6415242848"
  "6425007646"
  "6451678836"
  "6462156306"
  "6512928723"
  "6522986461"
  "7235047225"
  "7516553492"
)

# Start JSON array
echo "[" > "$OUTPUT"

FIRST=true
for cert in "${CERTS[@]}"; do
  PDF="$HOME/Desktop/GIA Certs/${cert}.pdf"
  echo "Processing: $cert"

  # Run with 5 minute timeout
  RESULT=$(gtimeout 300 node "$SCRIPT" "$PDF" --json --quiet 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ] && [ -n "$RESULT" ]; then
    echo "  SUCCESS"
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      echo "," >> "$OUTPUT"
    fi
    # Create entry
    echo "  {" >> "$OUTPUT"
    echo "    \"cert_number\": \"$cert\"," >> "$OUTPUT"
    echo "    \"file\": \"$PDF\"," >> "$OUTPUT"
    # Extract analysis part from result
    echo "    \"analysis\": $RESULT" >> "$OUTPUT"
    echo "  }" >> "$OUTPUT"
  else
    echo "  FAILED (exit: $EXIT_CODE)"
    # Still add entry with error info
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      echo "," >> "$OUTPUT"
    fi
    echo "  {" >> "$OUTPUT"
    echo "    \"cert_number\": \"$cert\"," >> "$OUTPUT"
    echo "    \"file\": \"$PDF\"," >> "$OUTPUT"
    echo "    \"error\": \"Process failed with exit code $EXIT_CODE\"," >> "$OUTPUT"
    echo "    \"raw_output\": $(echo "$RESULT" | head -20 | tr -d '\n' | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()[:500]))")" >> "$OUTPUT"
    echo "  }" >> "$OUTPUT"
  fi

  # Small delay between calls
  sleep 2
done

echo "]" >> "$OUTPUT"

echo ""
echo "Done! Output: $OUTPUT"
wc -l "$OUTPUT"
