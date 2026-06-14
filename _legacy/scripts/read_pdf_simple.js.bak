const PDFParser = require('pdf2json');
const fs = require('fs');

const path = process.argv[2] || '/Users/ally/Desktop/Rapaport/Round Price List 01.30.2026.pdf';

// 禁用 worker
process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1); // 1 = 禁用 worker

let output = [];

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    if (!pdfData.formImage || !pdfData.formImage.Pages) {
        console.log('No pages found');
        return;
    }

    // 提取所有文字連同座標
    const allTexts = [];
    
    pdfData.formImage.Pages.forEach((page, pageIdx) => {
        if (page.Texts) {
            page.Texts.forEach(t => {
                if (t.R && t.R[0] && t.R[0].T) {
                    allTexts.push({
                        page: pageIdx + 1,
                        x: Math.round(t.x * 100) / 100,
                        y: Math.round(t.y * 100) / 100,
                        text: decodeURIComponent(t.R[0].T)
                    });
                }
            });
        }
    });

    // 簡單輸出頭 100 個文字元素
    console.log(JSON.stringify(allTexts.slice(0, 100), null, 2));
    
    // 輸出總數
    console.error(`Total text elements: ${allTexts.length}`);
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
