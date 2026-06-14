#!/usr/bin/env python3
"""
Advanced handwriting removal using color and alignment analysis
Compares color consistency and alignment patterns
"""

import fitz
import cv2
import numpy as np
from PIL import Image
import io
import sys
import os

def analyze_color_and_alignment(image):
    """
    Analyze color characteristics and alignment patterns
    """
    # Convert to different color spaces
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    
    # Get binary image
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Find components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    components = []
    
    for i in range(1, num_labels):
        x = stats[i, cv2.CC_STAT_LEFT]
        y = stats[i, cv2.CC_STAT_TOP]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        area = stats[i, cv2.CC_STAT_AREA]
        
        if area < 10:
            continue
        
        # Create component mask
        component_mask = (labels == i).astype(np.uint8)
        
        # === COLOR ANALYSIS ===
        # Extract pixel values for this component
        component_pixels = image[component_mask > 0]
        
        if len(component_pixels) == 0:
            continue
        
        # Average color (BGR)
        avg_color = np.mean(component_pixels, axis=0)
        
        # Color variance (printed text has consistent color)
        color_std = np.std(component_pixels, axis=0)
        color_consistency = np.mean(color_std)
        
        # Check if it's pure black/very dark (printed text)
        is_pure_black = np.all(avg_color < 80)
        
        # === ALIGNMENT ANALYSIS ===
        # Check if component aligns with baseline
        # Printed text typically aligns horizontally
        
        # Get center point
        cx = x + w // 2
        cy = y + h // 2
        
        # Check neighboring components at same y-level
        same_level_components = []
        for j in range(1, num_labels):
            if i == j:
                continue
            jx = stats[j, cv2.CC_STAT_LEFT]
            jy = stats[j, cv2.CC_STAT_TOP]
            jw = stats[j, cv2.CC_STAT_WIDTH]
            jh = stats[j, cv2.CC_STAT_HEIGHT]
            
            jcy = jy + jh // 2
            
            # Check if at similar vertical level (within 10 pixels)
            if abs(jcy - cy) < 10:
                same_level_components.append(j)
        
        # Alignment score - more neighbors at same level = better alignment
        alignment_score = len(same_level_components)
        
        # === GEOMETRIC FEATURES ===
        aspect_ratio = w / max(h, 1)
        density = area / (w * h + 1)
        
        components.append({
            'id': i,
            'x': x, 'y': y, 'w': w, 'h': h,
            'area': area,
            'aspect_ratio': aspect_ratio,
            'density': density,
            'avg_color': avg_color,
            'color_consistency': color_consistency,
            'is_pure_black': is_pure_black,
            'alignment_score': alignment_score,
            'cx': cx, 'cy': cy
        })
    
    return components, labels

def classify_by_color_and_alignment(components):
    """
    Classify components based on color and alignment
    """
    # Calculate statistics for the whole page
    black_components = [c for c in components if c['is_pure_black']]
    aligned_components = [c for c in components if c['alignment_score'] >= 2]
    
    avg_alignment = np.mean([c['alignment_score'] for c in components]) if components else 0
    
    for comp in components:
        # === PRINTED TEXT CHARACTERISTICS ===
        # 1. Pure black color (relaxed)
        # 2. Consistent color (relaxed)
        # 3. Good alignment with neighbors
        # 4. Regular aspect ratio
        
        is_likely_printed = (
            comp['avg_color'][0] < 100 and  # B channel dark
            comp['avg_color'][1] < 100 and  # G channel dark  
            comp['avg_color'][2] < 100 and  # R channel dark
            comp['color_consistency'] < 60 and
            comp['alignment_score'] >= 1 and
            0.15 <= comp['aspect_ratio'] <= 6 and
            0.2 <= comp['density'] <= 0.95
        )
        
        # === HANDWRITING CHARACTERISTICS ===
        # 1. Not pure black (blue, gray, etc.) - RELAXED
        # 2. Poor alignment (standalone)
        # 3. Irregular shape
        # 4. High color variance (different pen pressure)
        
        is_likely_handwriting = (
            (comp['avg_color'][0] > 120 or comp['avg_color'][1] > 120 or comp['avg_color'][2] > 120) or  # Not dark
            comp['color_consistency'] > 80 or  # Very inconsistent color
            (comp['alignment_score'] == 0 and comp['aspect_ratio'] > 5) or  # Isolated and elongated
            (comp['aspect_ratio'] > 8 and comp['density'] < 0.3)  # Very elongated and sparse
        )
        
        # === LINE DETECTION ===
        is_line = (
            (comp['h'] <= 3 and comp['w'] >= 20) or
            (comp['w'] <= 3 and comp['h'] >= 20)
        )
        
        if is_line:
            comp['classification'] = 'line'
        elif is_likely_handwriting and not is_likely_printed:
            comp['classification'] = 'handwriting'
        elif is_likely_printed:
            comp['classification'] = 'printed'
        else:
            comp['classification'] = 'unknown'
    
    return components

def advanced_cleaning(image):
    """
    Clean document using color and alignment analysis
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Get components with analysis
    components, labels = analyze_color_and_alignment(image)
    
    # Classify
    components = classify_by_color_and_alignment(components)
    
    # Create keep mask
    keep_mask = np.zeros_like(gray)
    
    for comp in components:
        if comp['classification'] in ['printed', 'line']:
            component_mask = (labels == comp['id']).astype(np.uint8) * 255
            keep_mask = cv2.bitwise_or(keep_mask, component_mask)
        elif comp['classification'] == 'unknown' and comp['area'] < 50:
            # Small unknown might be punctuation
            component_mask = (labels == comp['id']).astype(np.uint8) * 255
            keep_mask = cv2.bitwise_or(keep_mask, component_mask)
    
    # Dilate slightly
    kernel = np.ones((2, 2), np.uint8)
    keep_mask = cv2.dilate(keep_mask, kernel, iterations=1)
    
    # Create result
    result = cv2.bitwise_not(keep_mask)
    result_3ch = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)
    
    # Print analysis
    printed_count = sum(1 for c in components if c['classification'] == 'printed')
    handwriting_count = sum(1 for c in components if c['classification'] == 'handwriting')
    line_count = sum(1 for c in components if c['classification'] == 'line')
    
    print(f"  Printed: {printed_count}, Handwriting: {handwriting_count}, Lines: {line_count}")
    
    return result_3ch

def process_pdf_advanced(input_path, output_path):
    """Process PDF with advanced color and alignment analysis"""
    doc = fitz.open(input_path)
    new_doc = fitz.open()
    
    for page_num in range(len(doc)):
        print(f"Processing page {page_num + 1}/{len(doc)} with color/alignment analysis...")
        page = doc[page_num]
        
        rect = page.rect
        width, height = rect.width, rect.height
        
        # Good resolution
        mat = fitz.Matrix(3, 3)
        pix = page.get_pixmap(matrix=mat)
        
        img_data = pix.tobytes("png")
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Advanced cleaning
        result = advanced_cleaning(img)
        
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
    
    print(f"✓ Advanced cleaned PDF saved to: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python advanced_color_cleaning.py <input.pdf> <output.pdf>")
        sys.exit(1)
    
    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]
    
    if not os.path.exists(input_pdf):
        print(f"Error: File not found: {input_pdf}")
        sys.exit(1)
    
    process_pdf_advanced(input_pdf, output_pdf)
