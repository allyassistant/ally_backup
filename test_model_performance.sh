#!/bin/bash
# Model Performance Test Script

MODEL1="qwen3:14b"
MODEL2="qwen3.5:9b"

test_model() {
    local model=$1
    local prompt=$2
    local test_name=$3
    
    echo "=== $test_name [$model] ==="
    local start=$(date +%s%N)
    
    result=$(curl -s http://localhost:11434/api/generate \
        -d "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":false,\"options\":{\"num_predict\":200}}" 2>/dev/null)
    
    local end=$(date +%s%N)
    local duration=$(( (end - start) / 1000000 ))  # ms
    
    response=$(echo "$result" | jq -r '.response' 2>/dev/null)
    eval_count=$(echo "$result" | jq -r '.eval_count' 2>/dev/null)
    
    echo "Time: ${duration}ms"
    echo "Tokens: $eval_count"
    echo "Response: ${response:0:200}..."
    echo ""
}

echo "========================================"
echo "Model Performance Comparison"
echo "========================================"
echo ""

# Test 1: Simple greeting
test_model "$MODEL1" "Say hello in Traditional Chinese" "Test 1: 廣東話問候"
test_model "$MODEL2" "Say hello in Traditional Chinese" "Test 1: 廣東話問候"

# Test 2: Simple math
test_model "$MODEL1" "Calculate 23 * 47 step by step" "Test 2: 數學計算"
test_model "$MODEL2" "Calculate 23 * 47 step by step" "Test 2: 數學計算"

# Test 3: Logic reasoning
test_model "$MODEL1" "If a train travels 120km in 2 hours, how far in 5 hours? Explain." "Test 3: 邏輯推理"
test_model "$MODEL2" "If a train travels 120km in 2 hours, how far in 5 hours? Explain." "Test 3: 邏輯推理"

# Test 4: Code generation
test_model "$MODEL1" "Write a Python function to reverse a string" "Test 4: 代碼生成"
test_model "$MODEL2" "Write a Python function to reverse a string" "Test 4: 代碼生成"

echo "========================================"
echo "Test Complete"
echo "========================================"
