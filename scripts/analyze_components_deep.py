#!/usr/bin/env python3
"""
Deep component analysis - Distinguish printed text, handwriting, lines, and tables
Analyzes geometric features to classify different elements
"""

import cv2
import numpy as np
from PIL import Image
import sys
import json

def analyze_component_features(image_path):
    """
    Analyze all components and classify them by features
    """
    # Load image
    img = cv2.imread(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Binary threshold
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Find connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    components = []
    
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
        perimeter = 2 * (w + h)
        compactness = (4 * np.pi * area) / (perimeter ** 2 + 1)
        
        # Extract component mask
        component_mask = (labels == i).astype(np.uint8) * 255
        
        # Check for holes (filled vs outline)
        contours, _ = cv2.findContours(component_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        has_holes = len(contours) > 1
        
        # Calculate stroke width variation (handwriting has more variation)
        kernel_small = np.ones((3, 3), np.uint8)
        eroded = cv2.erode(component_mask, kernel_small, iterations=1)
        skeleton = cv2.bitwise_xor(component_mask, eroded)
        stroke_variation = np.std(skeleton[skeleton > 0]) if np.any(skeleton > 0) else 0
        
        # Classification rules
        classification = classify_component(
            area=area,
            width=w,
            height=h,
            aspect_ratio=aspect_ratio,
            density=density,
            compactness=compactness,
            has_holes=has_holes,
            stroke_variation=stroke_variation
        )
        
        components.append({
            "id": i,
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "area": int(area),
            "aspect_ratio": round(aspect_ratio, 2),
            "density": round(density, 2),
            "compactness": round(compactness, 2),
            "has_holes": bool(has_holes),
            "stroke_variation": round(float(stroke_variation), 2),
            "classification": classification
        })
    
    return components

def classify_component(area, width, height, aspect_ratio, density, compactness, has_holes, stroke_variation):
    """
    Classify component based on geometric features
    """
    # Very thin = likely a line
    is_horizontal_line = height <= 3 and width >= 20
    is_vertical_line = width <= 3 and height >= 20
    
    if is_horizontal_line or is_vertical_line:
        return "line"
    
    # Large rectangular = likely table border
    is_large_rect = (width > 100 or height > 100) and aspect_ratio > 0.1 and aspect_ratio < 10
    if is_large_rect and density < 0.3:
        return "table_border"
    
    # Printed text characteristics:
    # - Consistent stroke width (low stroke_variation)
    # - Regular density
    # - Often has holes (closed shapes like 'o', 'e', 'a')
    is_printed = (
        20 <= area <= 2000 and
        aspect_ratio < 5 and
        0.3 <= density <= 0.9 and
        stroke_variation < 50 and
        (has_holes or compactness > 0.1)
    )
    
    # Handwriting characteristics:
    # - Variable stroke width (high stroke_variation)
    # - Irregular density
    # - Often thin and elongated
    is_handwriting = (
        15 <= area <= 3000 and
        (stroke_variation > 50 or aspect_ratio > 3 or density < 0.3)
    )
    
    # If both match, use stroke variation as tie-breaker
    if is_printed and is_handwriting:
        if stroke_variation > 60:
            return "handwriting"
        else:
            return "printed_text"
    elif is_printed:
        return "printed_text"
    elif is_handwriting:
        return "handwriting"
    else:
        return "unknown"

def visualize_classification(image_path, components, output_path):
    """
    Visualize classification with different colors
    """
    img = cv2.imread(image_path)
    
    # Colors for different classifications
    colors = {
        "printed_text": (0, 255, 0),     # Green
        "handwriting": (0, 0, 255),       # Red
        "line": (255, 0, 0),              # Blue
        "table_border": (255, 255, 0),    # Cyan
        "unknown": (128, 128, 128)        # Gray
    }
    
    # Draw bounding boxes
    for comp in components:
        x, y = comp["x"], comp["y"]
        w, h = comp["width"], comp["height"]
        color = colors.get(comp["classification"], (128, 128, 128))
        
        cv2.rectangle(img, (x, y), (x + w, y + h), color, 2)
        cv2.putText(img, comp["classification"][:4], (x, y - 5), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    
    cv2.imwrite(output_path, img)
    print(f"✓ Visualization saved to: {output_path}")

def print_analysis_report(components):
    """
    Print detailed analysis report
    """
    # Group by classification
    grouped = {}
    for comp in components:
        cls = comp["classification"]
        if cls not in grouped:
            grouped[cls] = []
        grouped[cls].append(comp)
    
    print("\n" + "="*60)
    print("COMPONENT ANALYSIS REPORT")
    print("="*60)
    
    for cls, items in sorted(grouped.items()):
        print(f"\n📌 {cls.upper().replace('_', ' ')}: {len(items)} components")
        print("-" * 40)
        
        # Calculate averages
        avg_area = np.mean([c["area"] for c in items])
        avg_aspect = np.mean([c["aspect_ratio"] for c in items])
        avg_density = np.mean([c["density"] for c in items])
        avg_stroke = np.mean([c["stroke_variation"] for c in items])
        
        print(f"  Average Area: {avg_area:.1f}")
        print(f"  Average Aspect Ratio: {avg_aspect:.2f}")
        print(f"  Average Density: {avg_density:.2f}")
        print(f"  Average Stroke Variation: {avg_stroke:.2f}")
        
        # Show first 3 examples
        print(f"\n  Examples (first 3):")
        for i, comp in enumerate(items[:3]):
            print(f"    #{comp['id']}: {comp['width']}x{comp['height']}, "
                  f"area={comp['area']}, AR={comp['aspect_ratio']}, "
                  f"density={comp['density']}, stroke_var={comp['stroke_variation']}")
    
    print("\n" + "="*60)
    print(f"TOTAL COMPONENTS: {len(components)}")
    print("="*60)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python analyze_components.py <input_image> <output_image>")
        print("\nAnalyzes components and visualizes classification:")
        print("  🟢 Green = Printed text")
        print("  🔴 Red = Handwriting")
        print("  🔵 Blue = Lines")
        print("  🟡 Cyan = Table borders")
        print("  ⬜ Gray = Unknown")
        sys.exit(1)
    
    input_image = sys.argv[1]
    output_image = sys.argv[2]
    
    print("🔍 Analyzing components...")
    components = analyze_component_features(input_image)
    
    print_analysis_report(components)
    
    print("\n🎨 Creating visualization...")
    visualize_classification(input_image, components, output_image)
    
    # Save detailed report
    report_path = output_image.replace('.png', '_report.json')
    with open(report_path, 'w') as f:
        json.dump(components, f, indent=2)
    print(f"✓ Detailed report saved to: {report_path}")
