#!/usr/bin/env python3
"""
Extract PDF page and analyze components
"""

import fitz
import cv2
import numpy as np
import sys
import os

def extract_page(pdf_path, page_num=0, dpi=200):
    """Extract a page from PDF as image"""
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    
    # Render at specified DPI
    mat = fitz.Matrix(dpi/72, dpi/72)
    pix = page.get_pixmap(matrix=mat)
    
    # Convert to numpy array
    img_data = pix.tobytes("png")
    nparr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    doc.close()
    return img

if __name__ == "__main__":
    pdf_path = "/Users/ally/.openclaw/media/inbound/3638fa98-489e-4726-bd4f-5a209cbb16b0.pdf"
    output_path = "/Users/ally/.openclaw/media/outbound/page_for_analysis.png"
    
    print("📄 Extracting PDF page...")
    img = extract_page(pdf_path, page_num=0, dpi=200)
    cv2.imwrite(output_path, img)
    print(f"✓ Page saved to: {output_path}")
    print(f"  Size: {img.shape[1]}x{img.shape[0]} pixels")
    
    # Now run analysis
    print("\n🔍 Running component analysis...")
    analysis_output = "/Users/ally/.openclaw/media/outbound/analyzed_page.png"
    os.system(f"python3 /Users/ally/.openclaw/workspace/scripts/analyze_components_deep.py {output_path} {analysis_output}")
