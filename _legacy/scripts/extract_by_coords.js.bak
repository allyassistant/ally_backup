const PDFParser = require('pdf2json');
const fs = require('fs');

const path = process.argv[2] || '/Users/ally/Desktop/Rapaport/Round Price List 01.30.2026.pdf';

process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1);

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    if (!pdfData.formImage || !pdfData.formImage.Pages) {
        console.log('No pages found');
        return;
    }

    // 提取所有文字連同座標
    let allTexts = [];
    
    pdfData.formImage.Pages.forEach((page, pageIdx) => {
        if (page.Texts) {
            page.Texts.forEach(t => {
                if (t.R && t.R[0] && t.R[0].T) {
                    allTexts.push({
                        page: pageIdx + 1,
                        x: Math.round(t.x * 100) / 100,
                        y: Math.round(t.y * 100) / 100,
                        text: decodeURIComponent(t.R[0].T).trim()
                    });
                }
            });
        }
    });

    // 搵 "5.00 - 5.99" 位置
    const targetRange = allTexts.find(t => t.text.includes('5.00') && t.text.includes('5.99'));
    
    if (!targetRange) {
        console.log('找不到 5.00-5.99 表');
        return;
    }
    
    console.log('找到 5.00-5.99 CT 表在:', targetRange);
    
    // 搵呢張表附近嘅數據 (Y 座標 ± 一個範圍)
    const tableY = targetRange.y;
    const tableTexts = allTexts.filter(t => 
        Math.abs(t.y - tableY) < 100 && 
        t.x > targetRange.x - 50 &&
        t.x < targetRange.x + 400
    );
    
    // 按 Y 然後 X 排序
    tableTexts.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 3) return a.x - b.x;
        return a.y - b.y;
    });
    
    console.log('\n=== 5.00-5.99 CT 表數據 (按座標排序) ===');
    
    // 分組顯示 (按 Y 座標相近嘅為一行)
    let currentRow = [];
    let currentY = null;
    
    tableTexts.forEach(t => {
        if (currentY === null || Math.abs(t.y - currentY) > 2) {
            if (currentRow.length > 0) {
                console.log(`Y=${Math.round(currentY)}: ${currentRow.map(x => x.text).join(' | ')}`);
            }
            currentRow = [];
            currentY = t.y;
        }
        currentRow.push(t);
    });
    
    if (currentRow.length > 0) {
        console.log(`Y=${Math.round(currentY)}: ${currentRow.map(x => x.text).join(' | ')}`);
    }
    
    // 輸出原始座標數據
    console.log('\n=== 原始座標數據 (前 50 個) ===');
    tableTexts.slice(0, 50).forEach(t => {
        console.log(`X=${t.x.toFixed(1)}, Y=${t.y.toFixed(1)}: "${t.text}"`);
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
