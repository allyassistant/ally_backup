#!/usr/bin/env python3
"""
Balanced approach: Keep small printed text, aggressively remove handwriting
Uses multi-stage classification with stricter handwriting detection
"""

import fitz
import cv2
import numpy as np
from PIL import Image
import io
import sys
import os

def balanced_cleaning(image):
    """
    Balance between keeping small printed text and removing handwriting
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Step 1: Detect all lines first (preserve these)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    horizontal = cv2.morphologyEx(gray, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)
    _, h_lines = cv2.threshold(horizontal, 180, 255, cv2.THRESH_BINARY_INV)
    
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
    vertical = cv2.morphologyEx(gray, cv2.MORPH_OPEN, vertical_kernel, iterations=2)
    _, v_lines = cv2.threshold(vertical, 180, 255, cv2.THRESH_BINARY_INV)
    
    lines_mask = cv2.bitwise_or(h_lines, v_lines)
    
    # Step 2: Get all components
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    # Step 3: Analyze and classify each component
    keep_mask = np.zeros_like(gray)
    
    # First pass: identify all handwriting candidates
    handwriting_candidates = []
    printed_candidates = []
    
    for i in range(1, num_labels):
        x = stats[i, cv2.CC_STAT_LEFT]
        y = stats[i, cv2.CC_STAT_TOP]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        area = stats[i, cv2.CC_STAT_AREA]
        
        if area < 5:
            continue
        
        aspect_ratio = w / max(h, 1)
        density = area / (w * h + 1)
        
        # Check if overlaps with lines
        component_mask = (labels == i).astype(np.uint8) * 255
        line_overlap = cv2.bitwise_and(component_mask, lines_mask)
        is_line = np.sum(line_overlap) > area * 0.5
        
        # STRICT handwriting detection (based on analysis: AR > 6, density < 0.35)
        is_handwriting = (
            aspect_ratio > 6 and density < 0.4
        ) or (
            aspect_ratio > 10  # Very elongated
        ) or (
            density < 0.25 and area > 50  # Very sparse
        )
        
        # Printed text detection (more inclusive for small text)
        is_printed = (
            (0.15 <= aspect_ratio <= 6) and
            (0.2 <= density <= 0.95) and
            (8 <= area <= 10000)
        )
        
        # Line detection
        is_horizontal_line = h <= 3 and w >= 15
        is_vertical_line = w <= 3 and h >= 15
        
        if is_line or is_horizontal_line or is_vertical_line:
            keep_mask = cv2.bitwise_or(keep_mask, component_mask)
        elif is_handwriting and not is_printed:
            # Mark for removal (skip)
            pass
        elif is_printed:
            printed_candidates.append(i)
        elif area < 30 and density > 0.3:
            # Small dots/punctuation - likely printed
            printed_candidates.append(i)
    
    # Second pass: keep printed candidates and their neighbors
    for i in printed_candidates:
        component_mask = (labels == i).astype(np.uint8) * 255
        keep_mask = cv2.bitwise_or(keep_mask, component_mask)
    
    # Step 4: Clean up
    # Dilate slightly to make text more solid
    kernel = np.ones((2, 2), np.uint8)
    keep_mask = cv2.dilate(keep_mask, kernel, iterations=1)
    
    # Create white background result
    result = cv2.bitwise_not(keep_mask)
    result_3ch = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)
    
    return result_3ch

def process_pdf_balanced(input_path, output_path):
    """Process PDF with balanced cleaning"""
    doc = fitz.open(input_path)
    new_doc = fitz.open()
    
    for page_num in range(len(doc)):
        print(f"Processing page {page_num + 1}/{len(doc)}...")
        page = doc[page_num]
        
        rect = page.rect
        width, height = rect.width, rect.height
        
        # Good resolution
        mat = fitz.Matrix(3, 3)
        pix = page.get_pixmap(matrix=mat)
        
        img_data = pix.tobytes("png")
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Balanced cleaning
        result = balanced_cleaning(img)
        
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
    
    new_doc.save(output_path, garbage=4, deflate=True)
    new_doc.close()
    doc.close()
    
    print(f"✓ Balanced cleaned PDF saved to: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python balanced_cleaning.py <input.pdf> <output.pdf>")
        sys.exit(1)
    
    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    
    if not os.path.exists(input_pdf):
        print(f"Error: File not found: {input_pdf}")
        sys.exit(1)
    
    process_pdf_balanced(input_pdf, output_pdf)
