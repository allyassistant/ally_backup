#!/usr/bin/env python3
"""
Context-aware document cleaning
Uses document structure analysis to distinguish original content from additions
"""

import fitz
import cv2
import numpy as np
from PIL import Image
import io
import os
import sys

def analyze_document_structure(image):
    """
    Analyze document structure: text blocks, tables, lines
    Returns structure mask and content classification
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Step 1: Detect document structure (lines, tables)
    # Horizontal lines (table rows, underlines)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (50, 1))
    horizontal = cv2.morphologyEx(gray, cv2.MORPH_OPEN, horizontal_kernel)
    _, h_lines = cv2.threshold(horizontal, 150, 255, cv2.THRESH_BINARY_INV)
    
    # Vertical lines (table columns)
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 50))
    vertical = cv2.morphologyEx(gray, cv2.MORPH_OPEN, vertical_kernel)
    _, v_lines = cv2.threshold(vertical, 150, 255, cv2.THRESH_BINARY_INV)
    
    # Combine lines
    lines_mask = cv2.bitwise_or(h_lines, v_lines)
    
    # Step 2: Detect text regions using MSER
    mser = cv2.MSER_create()
    regions, _ = mser.detectRegions(gray)
    
    # Filter regions
    text_mask = np.zeros_like(gray)
    for region in regions:
        x, y, w, h = cv2.boundingRect(region.reshape(-1, 1, 2))
        if 10 < w < 500 and 10 < h < 100 and w/h < 20:
            cv2.rectangle(text_mask, (x, y), (x+w, y+h), 255, -1)
    
    return lines_mask, text_mask

def context_aware_cleaning(image):
    """
    Clean document using context and structure analysis
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Get document structure
    lines_mask, text_mask = analyze_document_structure(image)
    
    # Binary image
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Find all components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    # Create masks
    keep_mask = np.zeros_like(gray)
    lines_keep = np.zeros_like(gray)
    
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
        
        component_mask = (labels == i).astype(np.uint8) * 255
        
        # Check if component overlaps with detected lines
        line_overlap = cv2.bitwise_and(component_mask, lines_mask)
        is_part_of_line = np.sum(line_overlap) > area * 0.3
        
        # Check if component is within text region
        text_overlap = cv2.bitwise_and(component_mask, text_mask)
        is_in_text_region = np.sum(text_overlap) > area * 0.1
        
        # Classification rules
        is_likely_line = (h <= 4 and w >= 20) or (w <= 4 and h >= 20) or is_part_of_line
        
        is_likely_printed = (
            (0.2 <= aspect_ratio <= 6) and
            (0.25 <= density <= 0.95) and
            (10 <= area <= 8000) and
            (is_in_text_region or area > 100)
        )
        
        # More conservative handwriting detection
        is_likely_handwriting = (
            aspect_ratio > 6 and 
            density < 0.35 and 
            area < 500 and
            not is_in_text_region
        )
        
        # Keep decision
        if is_likely_line:
            lines_keep = cv2.bitwise_or(lines_keep, component_mask)
        elif is_likely_printed and not is_likely_handwriting:
            keep_mask = cv2.bitwise_or(keep_mask, component_mask)
        elif is_in_text_region and area > 30 and aspect_ratio < 8:
            # Small printed text in text regions
            keep_mask = cv2.bitwise_or(keep_mask, component_mask)
    
    # Combine
    final_mask = cv2.bitwise_or(keep_mask, lines_keep)
    
    # Dilate slightly to connect broken printed text
    kernel = np.ones((2, 2), np.uint8)
    final_mask = cv2.dilate(final_mask, kernel, iterations=1)
    
    # Create white background result
    result = cv2.bitwise_not(final_mask)
    result_3ch = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)
    
    return result_3ch

def process_pdf_context_aware(input_path, output_path):
    """Process PDF with context-aware cleaning"""
    doc = fitz.open(input_path)
    new_doc = fitz.open()
    
    for page_num in range(len(doc)):
        print(f"Processing page {page_num + 1}/{len(doc)} with context analysis...")
        page = doc[page_num]
        
        rect = page.rect
        width, height = rect.width, rect.height
        
        # Higher resolution for better analysis
        mat = fitz.Matrix(3, 3)
        pix = page.get_pixmap(matrix=mat)
        
        img_data = pix.tobytes("png")
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Context-aware cleaning
        result = context_aware_cleaning(img)
        
        # Convert to PIL
        result_rgb = cv2.cvtColor(result, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(result_rgb)
        
        # Save with good quality
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
    
    print(f"✓ Context-aware cleaned PDF saved to: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python context_aware_cleaning.py <input.pdf> <output.pdf>")
        sys.exit(1)
    
    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    
    if not os.path.exists(input_pdf):
        print(f"Error: File not found: {input_pdf}")
        sys.exit(1)
    
    process_pdf_context_aware(input_pdf, output_pdf)
