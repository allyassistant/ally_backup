#!/usr/bin/env node
/**
 * Ollama Model Comparison Script
 * Tests qwen2.5:3b vs gemma4:e2b with same prompts
 */

const http = require('http');

const MODELS = ['qwen2.5:3b', 'gemma4:e2b'];
const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;

const PROMPTS = [
  { name: 'Cantonese Introduction', prompt: '用廣東話自我介紹，一句就好', max_tokens: 100 },
  { name: 'English Summary', prompt: 'Summarize this: The quick brown fox jumps over the lazy dog. Give me one sentence.', max_tokens: 100 },
  { name: 'Chinese Understanding', prompt: '解釋以下句子：「團結就是力量」', max_tokens: 150 },
  { name: 'Coding Task', prompt: 'Write a simple hello world in Python', max_tokens: 200 },
  { name: 'Creative Writing', prompt: '用一句話形容下雨天的香港', max_tokens: 80 },
];

function callOllama(model, prompt, maxTokens = 150) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model,
      prompt: prompt,
      options: { num_predict: maxTokens, temperature: 0.7 },
      stream: false
    });

    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            response: json.response || '(empty)',
            done: json.done,
            eval_count: json.eval_count,
            total_duration: json.total_duration
          });
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}, data: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runComparison() {
  console.log('🔬 Ollama Model Comparison: qwen2.5:3b vs gemma4:e2b\n');
  console.log('=' .repeat(60));

  for (const { name, prompt, max_tokens } of PROMPTS) {
    console.log(`\n📝 Test: ${name}`);
    console.log(`   Prompt: "${prompt}"`);
    console.log('-'.repeat(60));

    for (const model of MODELS) {
      try {
        const start = Date.now();
        const result = await callOllama(model, prompt, max_tokens);
        const duration = ((result.total_duration || 0) / 1e9).toFixed(2);

        const response = result.response.trim();
        const isEmpty = response === '(empty)' || response.length === 0;

        console.log(`\n   ${model.toUpperCase()}:`);
        console.log(`   ├─ Output: ${isEmpty ? '❌ EMPTY' : `"${response.substring(0, 80)}${response.length > 80 ? '...' : ''}"`}`);
        console.log(`   ├─ Length: ${response.length} chars`);
        console.log(`   ├─ Eval: ${result.eval_count || 0} tokens`);
        console.log(`   └─ Time: ${duration}s`);

        if (isEmpty) {
          console.log(`   ⚠️  WARNING: Empty response!`);
        }
      } catch (e) {
        console.log(`\n   ${model.toUpperCase()}:`);
        console.log(`   └─ ❌ ERROR: ${e.message}`);
      }
    }
    console.log();
  }

  console.log('='.repeat(60));
  console.log('✅ Comparison complete');
}

runComparison().catch(console.error);
