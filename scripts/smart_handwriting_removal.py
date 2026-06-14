#!/usr/bin/env python3
"""
Smart handwriting removal based on component analysis
Preserves: printed text, lines, table borders
Removes: handwriting based on aspect ratio and density features
"""

import fitz
import cv2
import numpy as np
from PIL import Image
import io
import sys
import os

def smart_remove_handwriting(image):
    """
    Remove handwriting based on component features
    """
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Binary threshold
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Find connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    # Create mask for components to KEEP
    keep_mask = np.zeros_like(gray)
    
    for i in range(1, num_labels):  # Skip background
        x = stats[i, cv2.CC_STAT_LEFT]
        y = stats[i, cv2.CC_STAT_TOP]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        area = stats[i, cv2.CC_STAT_AREA]
        
        # Skip very small noise
        if area < 10:
            continue
        
        # Calculate features
        aspect_ratio = w / max(h, 1)
        density = area / (w * h + 1)
        
        # Classification logic based on analysis
        is_line = (h <= 3 and w >= 20) or (w <= 3 and h >= 20)
        is_table_border = area > 10000 and density < 0.1
        is_printed_text = (
            (0.3 <= aspect_ratio <= 5) and  # Not too extreme
            (0.3 <= density <= 0.9) and      # Medium density
            (20 <= area <= 5000)             # Reasonable size
        )
        
        # Handwriting characteristics from analysis:
        # - High aspect ratio (>5)
        # - Low density (<0.3)
        # - OR very irregular shapes
        is_handwriting = (
            aspect_ratio > 5 and density < 0.4
        ) or (
            aspect_ratio > 8  # Very elongated
        )
        
        # Keep if it's printed text, line, or table border
        if (is_printed_text or is_line or is_table_border) and not is_handwriting:
            component_mask = (labels == i).astype(np.uint8) * 255
            keep_mask = cv2.bitwise_or(keep_mask, component_mask)
    
    # Dilate slightly to make text more solid
    kernel = np.ones((2, 2), np.uint8)
    keep_mask = cv2.dilate(keep_mask, kernel, iterations=1)
    
    # Create result - white background with black kept content
    result = cv2.bitwise_not(keep_mask)
    result_3ch = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)
    
    return result_3ch

def process_pdf_smart(input_path, output_path):
    """Process PDF with smart handwriting removal"""
    doc = fitz.open(input_path)
    new_doc = fitz.open()
    
    for page_num in range(len(doc)):
        print(f"Processing page {page_num + 1}/{len(doc)}...")
        page = doc[page_num]
        
        rect = page.rect
        width, height = rect.width, rect.height
        
        # Good resolution
        mat = fitz.Matrix(2.5, 2.5)
        pix = page.get_pixmap(matrix=mat)
        
        img_data = pix.tobytes("png")
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Smart removal
        result = smart_remove_handwriting(img)
        
        # Convert to PIL
        result_rgb = cv2.cvtColor(result, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(result_rgb)
        
        # Save
        img_byte_arr = io.BytesIO()
        pil_img.save(img_byte_arr, format='PNG', optimize=True)
        img_byte_arr.seek(0)
        
        # Create new page
        new_page = new_doc.new_page(width=width, height=height)
        img_rect = fitz.Rect(0, 0, width, height)
        new_page.insert_image(img_rect, stream=img_byte_arr.getvalue())
    
    # Save with compression
    new_doc.save(output_path, garbage=4, deflate=True)
    new_doc.close()
    doc.close()
    
    print(f"✓ Smart cleaned PDF saved to: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python smart_handwriting_removal.py <input.pdf> <output.pdf>")
        sys.exit(1)
    
    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    
    if not os.path.exists(input_pdf):
        print(f"Error: File not found: {input_pdf}")
        sys.exit(1)
    
    process_pdf_smart(input_pdf, output_pdf)
